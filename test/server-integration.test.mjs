import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const SERVER_READY_PATTERN = /Dextunnel MVP listening on http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/;

function extractSurfaceBootstrap(html) {
  const match = html.match(/window\.__DEXTUNNEL_SURFACE_BOOTSTRAP__ = (\{.*?\});/s);
  if (!match) {
    throw new Error("Missing surface bootstrap in html.");
  }
  return JSON.parse(match[1]);
}

async function fetchSurfaceBootstrap(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`);
  const html = await response.text();
  return extractSurfaceBootstrap(html);
}

function createSseClient(baseUrl, path = "/api/stream", { surfaceToken = "" } = {}) {
  const controller = new AbortController();
  const decoder = new TextDecoder();
  const queue = [];
  const waiters = [];
  let buffer = "";
  let closed = false;

  const streamPromise = (async () => {
    const nextUrl = new URL(`${baseUrl}${path}`);
    if (surfaceToken) {
      nextUrl.searchParams.set("surfaceToken", surfaceToken);
    }
    const response = await fetch(nextUrl, {
      headers: {
        Accept: "text/event-stream"
      },
      signal: controller.signal
    });

    const reader = response.body.getReader();
    while (!closed) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        let eventName = "message";
        let data = "";
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data += line.slice(5).trim();
          }
        }

        const payload = {
          data: data ? JSON.parse(data) : null,
          event: eventName
        };
        queue.push(payload);
        while (waiters.length) {
          const waiter = waiters.shift();
          waiter();
        }
      }
    }
  })().catch((error) => {
    if (closed || error.name === "AbortError") {
      return;
    }
    throw error;
  });

  async function waitForEvent(eventName, predicate = () => true, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const matchIndex = queue.findIndex(
        (entry) => entry.event === eventName && predicate(entry.data)
      );
      if (matchIndex !== -1) {
        return queue.splice(matchIndex, 1)[0];
      }

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.indexOf(onResolve);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
          reject(new Error(`Timed out waiting for SSE ${eventName}.`));
        }, Math.max(20, deadline - Date.now()));

        function onResolve() {
          clearTimeout(timeout);
          resolve();
        }

        waiters.push(onResolve);
      }).catch((error) => {
        if (Date.now() >= deadline) {
          throw error;
        }
      });
    }

    throw new Error(`Timed out waiting for SSE ${eventName}.`);
  }

  return {
    async close() {
      closed = true;
      controller.abort();
      await streamPromise;
    },
    waitForEvent
  };
}

async function waitFor(assertion, { timeoutMs = 4000, intervalMs = 40 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await delay(intervalMs);
    }
  }

  throw lastError || new Error("Timed out waiting for condition.");
}

async function requestJson(baseUrl, path, options = {}) {
  const { surfaceToken = "", ...fetchOptions } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: {
      ...(fetchOptions.headers || {}),
      ...(surfaceToken ? { "x-dextunnel-surface-token": surfaceToken } : {})
    }
  });
  const payload = await response.json();
  return {
    ok: response.ok,
    payload,
    status: response.status
  };
}

async function startTestServer({ env = {} } = {}) {
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEXTUNNEL_FAKE_APP_SERVER: "1",
      DEXTUNNEL_PROFILE: "dev",
      PORT: "0",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let logs = "";
  let baseUrl = null;

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for test server.\n${logs}`));
    }, 5000);

    function onChunk(chunk) {
      logs += chunk;
      const match = logs.match(SERVER_READY_PATTERN);
      if (!match) {
        return;
      }

      baseUrl = `http://127.0.0.1:${match[1]}`;
      clearTimeout(timeout);
      resolve(baseUrl);
    }

    child.stdout.on("data", onChunk);
    child.stderr.on("data", (chunk) => {
      logs += chunk;
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Test server exited early with code=${code} signal=${signal}\n${logs}`));
    });
  });

  await ready;
  const remoteBootstrap = await fetchSurfaceBootstrap(baseUrl, "/remote.html");
  const hostBootstrap = await fetchSurfaceBootstrap(baseUrl, "/host.html");
  await waitFor(async () => {
    const response = await requestJson(baseUrl, "/api/codex-app-server/live-state", {
      surfaceToken: remoteBootstrap.accessToken
    });
    assert.equal(response.ok, true);
    assert.equal(response.payload.status.watcherConnected, true);
    return response.payload;
  });

  return {
    async close() {
      if (child.exitCode != null) {
        return;
      }

      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", resolve);
      });
    },
    getLogs() {
      return logs;
    },
    hostBootstrap,
    remoteBootstrap,
    url: baseUrl
  };
}

function surfaceTokenFor(server, surface = "remote") {
  return surface === "host"
    ? server.hostBootstrap.accessToken
    : server.remoteBootstrap.accessToken;
}

function surfaceClientIdFor(server, surface = "remote") {
  return surface === "host"
    ? server.hostBootstrap.clientId
    : server.remoteBootstrap.clientId;
}

async function fetchAdditionalSurfaceBootstrap(server, surface = "remote") {
  const route = surface === "host" ? "/host.html" : "/remote.html";
  return fetchSurfaceBootstrap(server.url, route);
}

function requestSurfaceJson(server, surface, path, options = {}) {
  return requestJson(server.url, path, {
    ...options,
    surfaceToken: surfaceTokenFor(server, surface)
  });
}

function createSurfaceSseClient(server, surface, path = "/api/stream") {
  return createSseClient(server.url, path, {
    surfaceToken: surfaceTokenFor(server, surface)
  });
}

test("server integration serves discovery docs and allows bearer-auth live-state reads", async () => {
  const server = await startTestServer();

  try {
    const manifestResponse = await fetch(`${server.url}/.well-known/dextunnel.json`);
    const manifest = await manifestResponse.json();
    assert.equal(manifestResponse.ok, true);
    assert.equal(manifest.preferredBootstrapSurface, "agent");
    assert.match(manifest.links.openapi, /\/openapi\.json$/);

    const openapiResponse = await fetch(`${server.url}/openapi.json`);
    const openapi = await openapiResponse.json();
    assert.equal(openapiResponse.ok, true);
    assert.equal(openapi.paths["/api/codex-app-server/turn"].post.operationId, "sendTurn");

    const llmsResponse = await fetch(`${server.url}/llms.txt`);
    const llms = await llmsResponse.text();
    assert.equal(llmsResponse.ok, true);
    assert.match(llms, /Authorization: Bearer <accessToken>/);

    const bootstrapResponse = await fetch(
      `${server.url}/api/codex-app-server/bootstrap?surface=agent`
    );
    const bootstrap = await bootstrapResponse.json();
    assert.equal(bootstrapResponse.ok, true);
    assert.equal(bootstrap.surface, "agent");

    const liveStateResponse = await fetch(`${server.url}/api/codex-app-server/live-state`, {
      headers: {
        Authorization: `Bearer ${bootstrap.accessToken}`
      }
    });
    const liveState = await liveStateResponse.json();
    assert.equal(liveStateResponse.ok, true);
    assert.equal(liveState.selectedThreadId, "thr_dextunnel");
  } finally {
    await server.close();
  }
});

test("server integration broadcasts shared-room selection to multiple SSE clients", async () => {
  const server = await startTestServer();
  const streamA = createSurfaceSseClient(server, "remote");
  const streamB = createSurfaceSseClient(server, "remote");

  try {
    await streamA.waitForEvent("live", () => true);
    await streamB.waitForEvent("live", () => true);

    const before = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    assert.equal(before.payload.selectedThreadId, "thr_dextunnel");

    const selection = await requestSurfaceJson(server, "host", "/api/codex-app-server/selection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: "ignored-by-server",
        threadId: "thr_marketing"
      })
    });

    assert.equal(selection.ok, true);
    assert.equal(selection.payload.state.selectedThreadId, "thr_marketing");

    const [eventA, eventB] = await Promise.all([
      streamA.waitForEvent("live", (payload) => payload.selectedThreadId === "thr_marketing"),
      streamB.waitForEvent("live", (payload) => payload.selectedThreadId === "thr_marketing")
    ]);

    assert.equal(eventA.data.selectedThreadId, "thr_marketing");
    assert.equal(eventB.data.selectedThreadId, "thr_marketing");
  } finally {
    await Promise.all([streamA.close(), streamB.close()]);
    await server.close();
  }
});

test("server integration enforces client-bound control and reflects presence changes", async () => {
  const server = await startTestServer();
  const stream = createSurfaceSseClient(server, "remote");

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const threadId = initial.payload.selectedThreadId;
    const remoteClientId = surfaceClientIdFor(server, "remote");
    await stream.waitForEvent("live", () => true);

    const presence = await requestSurfaceJson(server, "remote", "/api/codex-app-server/presence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: "ignored-by-server",
        engaged: true,
        focused: true,
        threadId,
        visible: true
      })
    });
    assert.equal(presence.ok, true);

    const presenceEvent = await stream.waitForEvent(
      "live",
      (payload) =>
        payload.selectedAttachments?.some((entry) => entry.surface === "remote" && entry.count === 1)
    );
    assert.equal(
      presenceEvent.data.selectedAttachments.some((entry) => entry.surface === "remote"),
      true
    );

    const claim = await requestSurfaceJson(server, "remote", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "claim",
        clientId: "ignored-by-server",
        threadId
      })
    });
    assert.equal(claim.ok, true);
    assert.equal(claim.payload.state.status.controlLeaseForSelection.ownerClientId, remoteClientId);

    const secondRemoteBootstrap = await fetchAdditionalSurfaceBootstrap(server, "remote");
    const deniedClaim = await requestJson(server.url, "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      surfaceToken: secondRemoteBootstrap.accessToken,
      body: JSON.stringify({
        action: "claim",
        clientId: "ignored-by-server",
        threadId
      })
    });
    assert.equal(deniedClaim.ok, false);
    assert.match(deniedClaim.payload.error, /holds control/i);
  } finally {
    await stream.close();
    await server.close();
  }
});

test("server integration releases a remote lease through the real control route", async () => {
  const server = await startTestServer();

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const threadId = initial.payload.selectedThreadId;
    const remoteClientId = surfaceClientIdFor(server, "remote");

    const claim = await requestSurfaceJson(server, "remote", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "claim",
        clientId: "ignored-by-server",
        threadId
      })
    });
    assert.equal(claim.ok, true);
    assert.equal(claim.payload.state.status.controlLeaseForSelection.ownerClientId, remoteClientId);

    const release = await requestSurfaceJson(server, "host", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "release",
        clientId: "ignored-by-server",
        threadId
      })
    });

    assert.equal(release.ok, true);
    assert.equal(release.payload.state.status.controlLeaseForSelection, null);
    assert.equal(release.payload.state.status.lastControlEventForSelection?.action, "release");
    assert.equal(release.payload.state.status.lastControlEventForSelection?.actor, "host");
    assert.equal(
      release.payload.state.status.lastControlEventForSelection?.ownerClientId,
      remoteClientId
    );
  } finally {
    await server.close();
  }
});

test("server integration rejects a second remote releasing another remote lease", async () => {
  const server = await startTestServer();

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const threadId = initial.payload.selectedThreadId;
    const remoteClientId = surfaceClientIdFor(server, "remote");

    const claim = await requestSurfaceJson(server, "remote", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "claim",
        clientId: "ignored-by-server",
        threadId
      })
    });
    assert.equal(claim.ok, true);

    const secondRemoteBootstrap = await fetchAdditionalSurfaceBootstrap(server, "remote");
    const deniedRelease = await requestJson(server.url, "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      surfaceToken: secondRemoteBootstrap.accessToken,
      body: JSON.stringify({
        action: "release",
        clientId: "ignored-by-server",
        threadId
      })
    });

    assert.equal(deniedRelease.ok, false);
    assert.match(deniedRelease.payload.error, /another remote surface currently holds control/i);
    assert.equal(
      deniedRelease.payload.state.status.controlLeaseForSelection?.ownerClientId,
      remoteClientId
    );
  } finally {
    await server.close();
  }
});

test("server integration resolves a pending interaction through the real route", async () => {
  const server = await startTestServer();
  const stream = createSurfaceSseClient(server, "remote");

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const threadId = initial.payload.selectedThreadId;
    const remoteClientId = surfaceClientIdFor(server, "remote");
    await stream.waitForEvent("live", () => true);

    const claim = await requestSurfaceJson(server, "remote", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "claim",
        clientId: "ignored-by-server",
        threadId
      })
    });
    assert.equal(claim.ok, true);

    const createPending = await requestSurfaceJson(server, "host", "/api/debug/live-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        kind: "user_input"
      })
    });
    assert.equal(createPending.ok, true);
    assert.equal(createPending.payload.state.pendingInteraction.actionKind, "user_input");

    await stream.waitForEvent(
      "live",
      (payload) => payload.pendingInteraction?.actionKind === "user_input"
    );

    const resolved = await requestSurfaceJson(server, "remote", "/api/codex-app-server/interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "submit",
        answers: {
          deploy_note: "Ship it",
          token: "secret-token"
        },
        clientId: "ignored-by-server"
      })
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.payload.state.pendingInteraction, null);
    assert.equal(
      resolved.payload.state.status.lastInteractionForSelection?.status,
      "resolved"
    );
    assert.equal(
      resolved.payload.state.status.lastInteractionForSelection?.action,
      "submit"
    );
    assert.equal(
      resolved.payload.state.status.controlLeaseForSelection?.ownerClientId,
      remoteClientId
    );

    const createSecondPending = await requestSurfaceJson(server, "host", "/api/debug/live-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        kind: "user_input"
      })
    });
    assert.equal(createSecondPending.ok, true);
    assert.equal(createSecondPending.payload.state.pendingInteraction.actionKind, "user_input");

    const resolvedAgain = await requestSurfaceJson(server, "remote", "/api/codex-app-server/interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "submit",
        answers: {
          deploy_note: "Ship it again",
          token: "secret-token-2"
        },
        clientId: "ignored-by-server"
      })
    });

    assert.equal(resolvedAgain.ok, true);
    assert.equal(resolvedAgain.payload.state.pendingInteraction, null);
    assert.equal(
      resolvedAgain.payload.state.status.controlLeaseForSelection?.ownerClientId,
      remoteClientId
    );
  } finally {
    await stream.close();
    await server.close();
  }
});

test("server integration rejects pending interaction resolution from the wrong remote surface", async () => {
  const server = await startTestServer();

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const threadId = initial.payload.selectedThreadId;

    const claim = await requestSurfaceJson(server, "remote", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "claim",
        clientId: "ignored-by-server",
        threadId
      })
    });
    assert.equal(claim.ok, true);

    const createPending = await requestSurfaceJson(server, "host", "/api/debug/live-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        kind: "user_input"
      })
    });
    assert.equal(createPending.ok, true);
    assert.equal(createPending.payload.state.pendingInteraction.actionKind, "user_input");

    const secondRemoteBootstrap = await fetchAdditionalSurfaceBootstrap(server, "remote");
    const deniedResolution = await requestJson(server.url, "/api/codex-app-server/interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      surfaceToken: secondRemoteBootstrap.accessToken,
      body: JSON.stringify({
        action: "submit",
        answers: {
          deploy_note: "Ship it"
        },
        clientId: "ignored-by-server"
      })
    });

    assert.equal(deniedResolution.ok, false);
    assert.match(deniedResolution.payload.error, /another remote surface currently holds control/i);
    assert.equal(
      deniedResolution.payload.state.pendingInteraction?.actionKind,
      "user_input"
    );
  } finally {
    await server.close();
  }
});

test("server integration locks the live turn route until the send settles", async () => {
  const server = await startTestServer({
    env: {
      DEXTUNNEL_FAKE_SEND_DELAY_MS: "180"
    }
  });

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const threadId = initial.payload.selectedThreadId;

    const claim = await requestSurfaceJson(server, "remote", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "claim",
        clientId: "ignored-by-server",
        threadId
      })
    });
    assert.equal(claim.ok, true);

    const firstTurnPromise = requestSurfaceJson(server, "remote", "/api/codex-app-server/turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: "ignored-by-server",
        text: "Integration delayed send"
      })
    });

    await delay(30);

    const deniedTurn = await requestSurfaceJson(server, "remote", "/api/codex-app-server/turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: "ignored-by-server",
        text: "Second send while busy"
      })
    });
    assert.equal(deniedTurn.ok, false);
    assert.match(deniedTurn.payload.error, /already in progress/i);

    const completedTurn = await firstTurnPromise;
    assert.equal(completedTurn.ok, true);
    assert.equal(completedTurn.payload.thread.id, threadId);

    const completedWriteEvent = await waitFor(async () => {
      const response = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
      assert.equal(response.ok, true);
      assert.equal(response.payload.status?.writeLock, null);
      assert.equal(response.payload.status?.lastWriteForSelection?.threadId, threadId);
      assert.equal(response.payload.status?.lastWriteForSelection?.turnStatus, "completed");
      return response.payload;
    });
    assert.equal(
      completedWriteEvent.status.lastWriteForSelection.source,
      "remote"
    );

    const after = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    assert.equal(after.ok, true);
    assert.equal(after.payload.status.writeLock, null);
    assert.equal(
      after.payload.selectedThreadSnapshot.transcript.some(
        (entry) => entry.role === "user" && entry.text.includes("Integration delayed send")
      ),
      true
    );
    assert.equal(
      after.payload.selectedThreadSnapshot.transcript.some(
        (entry) => entry.role === "assistant" && entry.text.includes("FAKE_BRIDGE_ACK")
      ),
      true
    );
  } finally {
    await server.close();
  }
});

test("server integration can create a fresh thread, claim it, send the first turn, and read it back", async () => {
  const server = await startTestServer();

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const previousThreadId = initial.payload.selectedThreadId;

    const created = await requestSurfaceJson(server, "remote", "/api/codex-app-server/thread", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cwd: "/tmp/codex/fresh-thread"
      })
    });

    assert.equal(created.ok, true);
    const freshThreadId = created.payload.state.selectedThreadId;
    assert.ok(freshThreadId);
    assert.notEqual(freshThreadId, previousThreadId);
    assert.equal(created.payload.state.selectedThreadSnapshot.thread.id, freshThreadId);
    assert.equal(created.payload.state.selectedThreadSnapshot.transcriptCount, 0);

    const claim = await requestSurfaceJson(server, "remote", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "claim",
        threadId: freshThreadId
      })
    });
    assert.equal(claim.ok, true);

    const send = await requestSurfaceJson(server, "remote", "/api/codex-app-server/turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: "Fresh thread integration send",
        threadId: freshThreadId
      })
    });
    assert.equal(send.ok, true);
    assert.equal(send.payload.thread.id, freshThreadId);

    const threadRead = await requestSurfaceJson(
      server,
      "remote",
      `/api/codex-app-server/thread?threadId=${encodeURIComponent(freshThreadId)}&limit=40`
    );
    assert.equal(threadRead.ok, true);
    assert.equal(threadRead.payload.found, true);
    assert.equal(threadRead.payload.snapshot.thread.id, freshThreadId);
    assert.equal(
      threadRead.payload.snapshot.transcript.some(
        (entry) => entry.role === "user" && entry.text.includes("Fresh thread integration send")
      ),
      true
    );
    assert.equal(
      threadRead.payload.snapshot.transcript.some(
        (entry) => entry.role === "assistant" && entry.text.includes("FAKE_BRIDGE_ACK")
      ),
      true
    );
  } finally {
    await server.close();
  }
});

test("server integration rejects a send from the wrong remote surface while another remote owns control", async () => {
  const server = await startTestServer();

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const threadId = initial.payload.selectedThreadId;
    const remoteClientId = surfaceClientIdFor(server, "remote");

    const claim = await requestSurfaceJson(server, "remote", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "claim",
        clientId: "ignored-by-server",
        threadId
      })
    });
    assert.equal(claim.ok, true);

    const secondRemoteBootstrap = await fetchAdditionalSurfaceBootstrap(server, "remote");
    const deniedTurn = await requestJson(server.url, "/api/codex-app-server/turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      surfaceToken: secondRemoteBootstrap.accessToken,
      body: JSON.stringify({
        clientId: "ignored-by-server",
        text: "This should be blocked",
        threadId
      })
    });

    assert.equal(deniedTurn.ok, false);
    assert.match(deniedTurn.payload.error, /another remote surface currently holds control/i);
    assert.equal(
      deniedTurn.payload.state.status.controlLeaseForSelection?.ownerClientId,
      remoteClientId
    );
  } finally {
    await server.close();
  }
});

test("server integration keeps a newer room selection when an older send settles", async () => {
  const server = await startTestServer({
    env: {
      DEXTUNNEL_FAKE_SEND_DELAY_MS: "180"
    }
  });

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const originalThreadId = initial.payload.selectedThreadId;
    assert.equal(originalThreadId, "thr_dextunnel");

    const claim = await requestSurfaceJson(server, "remote", "/api/codex-app-server/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "claim",
        clientId: "ignored-by-server",
        threadId: originalThreadId
      })
    });
    assert.equal(claim.ok, true);

    const firstTurnPromise = requestSurfaceJson(server, "remote", "/api/codex-app-server/turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: "ignored-by-server",
        text: "Selection race probe",
        threadId: originalThreadId
      })
    });

    await delay(30);

    const switched = await requestSurfaceJson(server, "host", "/api/codex-app-server/selection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: "ignored-by-server",
        threadId: "thr_marketing"
      })
    });
    assert.equal(switched.ok, true);
    assert.equal(switched.payload.state.selectedThreadId, "thr_marketing");

    const completedTurn = await firstTurnPromise;
    assert.equal(completedTurn.ok, true);
    assert.equal(completedTurn.payload.thread.id, originalThreadId);

    const after = await waitFor(async () => {
      const response = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
      assert.equal(response.ok, true);
      assert.equal(response.payload.selectedThreadId, "thr_marketing");
      return response.payload;
    });

    assert.equal(after.selectedThreadSnapshot.thread.id, "thr_marketing");
    assert.equal(
      after.status.lastWrite?.threadId,
      originalThreadId
    );
    assert.equal(
      after.status.lastWriteForSelection,
      null
    );
  } finally {
    await server.close();
  }
});

test("server integration hides dev-only routes in the default runtime profile", async () => {
  const server = await startTestServer({
    env: {
      DEXTUNNEL_PROFILE: "default"
    }
  });

  try {
    const liveState = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    assert.equal(liveState.ok, true);
    assert.equal(liveState.payload.status.devToolsEnabled, false);

    const debugInteraction = await requestSurfaceJson(server, "host", "/api/debug/live-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        kind: "user_input"
      })
    });
    assert.equal(debugInteraction.status, 404);
    assert.equal(debugInteraction.payload.error, "Not found");

    const debugCommands = await requestSurfaceJson(server, "host", "/api/commands", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "noop"
      })
    });
    assert.equal(debugCommands.status, 404);
    assert.equal(debugCommands.payload.error, "Not found");
  } finally {
    await server.close();
  }
});

test("server integration requires a valid surface token for room APIs", async () => {
  const server = await startTestServer();

  try {
    const liveState = await requestJson(server.url, "/api/codex-app-server/live-state");
    assert.equal(liveState.ok, false);
    assert.equal(liveState.status, 403);
    assert.match(liveState.payload.error, /surface access is missing or expired/i);
  } finally {
    await server.close();
  }
});

test("server integration rejects host impersonation of remote send authority", async () => {
  const server = await startTestServer();

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    const threadId = initial.payload.selectedThreadId;

    const deniedTurn = await requestSurfaceJson(server, "host", "/api/codex-app-server/turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: "ignored-by-server",
        threadId,
        text: "Host should not be able to send"
      })
    });

    assert.equal(deniedTurn.ok, false);
    assert.equal(deniedTurn.status, 403);
    assert.match(deniedTurn.payload.error, /host surface is not allowed to send turn/i);
  } finally {
    await server.close();
  }
});

test("server integration rejects remote access to host-only debug routes", async () => {
  const server = await startTestServer();

  try {
    const deniedDebug = await requestSurfaceJson(server, "remote", "/api/debug/live-interaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        kind: "user_input"
      })
    });

    assert.equal(deniedDebug.ok, false);
    assert.equal(deniedDebug.status, 403);
    assert.match(deniedDebug.payload.error, /remote surface is not allowed to debug tools/i);
  } finally {
    await server.close();
  }
});

test("server integration runs the optional council room with fake advisor lanes", async () => {
  const server = await startTestServer({
    env: {
      DEXTUNNEL_FAKE_AGENT_ROOM: "1"
    }
  });
  const stream = createSurfaceSseClient(server, "remote");

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    assert.equal(initial.ok, true);
    const threadId = initial.payload.selectedThreadId;

    const enabled = await requestSurfaceJson(server, "remote", "/api/codex-app-server/agent-room", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "enable",
        threadId
      })
    });
    assert.equal(enabled.ok, true);
    assert.equal(enabled.payload.state.selectedAgentRoom.enabled, true);

    const started = await requestSurfaceJson(server, "remote", "/api/codex-app-server/agent-room", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "send",
        text: "Discuss the latest state and agree on one next step.",
        threadId
      })
    });
    assert.equal(started.ok, true);
    assert.equal(started.payload.state.selectedAgentRoom.round.status, "running");

    const completed = await waitFor(async () => {
      const response = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
      assert.equal(response.ok, true);
      assert.equal(response.payload.selectedAgentRoom.enabled, true);
      assert.equal(response.payload.selectedAgentRoom.messages.some((entry) => entry.role === "user"), true);
      assert.equal(response.payload.selectedAgentRoom.messages.some((entry) => entry.participantId === "nix"), true);
      assert.equal(response.payload.selectedAgentRoom.messages.some((entry) => entry.participantId === "spark"), true);
      assert.equal(response.payload.selectedAgentRoom.messages.some((entry) => entry.participantId === "gemini"), true);
      assert.equal(response.payload.selectedAgentRoom.messages.some((entry) => entry.participantId === "claude"), true);
      assert.equal(response.payload.selectedAgentRoom.messages.some((entry) => entry.participantId === "oracle"), true);
      assert.notEqual(response.payload.selectedAgentRoom.messages.length < 6, true);
      assert.notEqual(response.payload.selectedAgentRoom.round?.status, "running");
      return response.payload;
    }, { timeoutMs: 6000 });

    assert.notEqual(completed.selectedAgentRoom.round?.status, "running");
    const liveEvent = await stream.waitForEvent(
      "live",
      (payload) => payload.selectedAgentRoom?.messages?.some((entry) => entry.participantId === "oracle"),
      6000
    );
    assert.equal(
      liveEvent.data.selectedAgentRoom.messages.some((entry) => entry.participantId === "oracle"),
      true
    );
  } finally {
    await stream.close();
    await server.close();
  }
});

test("server integration retries failed fake council participants to a clean settle", async () => {
  const server = await startTestServer({
    env: {
      DEXTUNNEL_FAKE_AGENT_ROOM: "1",
      DEXTUNNEL_FAKE_AGENT_ROOM_FAILURES: "gemini:timeout,oracle:malformed"
    }
  });
  const stream = createSurfaceSseClient(server, "remote");

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    assert.equal(initial.ok, true);
    const threadId = initial.payload.selectedThreadId;

    const enabled = await requestSurfaceJson(server, "remote", "/api/codex-app-server/agent-room", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "enable",
        threadId
      })
    });
    assert.equal(enabled.ok, true);

    const started = await requestSurfaceJson(server, "remote", "/api/codex-app-server/agent-room", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "send",
        text: "Force one fake failure, then let retry recover the room.",
        threadId
      })
    });
    assert.equal(started.ok, true);
    assert.equal(started.payload.state.selectedAgentRoom.round.status, "running");

    const partial = await waitFor(async () => {
      const response = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
      assert.equal(response.ok, true);
      assert.equal(response.payload.selectedAgentRoom.round?.status, "partial");
      assert.deepEqual(
        response.payload.selectedAgentRoom.round?.failedParticipantIds?.sort(),
        ["gemini", "oracle"]
      );
      return response.payload;
    }, { timeoutMs: 6000 });
    assert.equal(partial.selectedAgentRoom.round?.canRetryFailed, true);

    const retried = await requestSurfaceJson(server, "remote", "/api/codex-app-server/agent-room", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "retry",
        threadId
      })
    });
    assert.equal(retried.ok, true);
    assert.equal(retried.payload.state.selectedAgentRoom.round.status, "running");

    const completed = await waitFor(async () => {
      const response = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
      assert.equal(response.ok, true);
      assert.equal(response.payload.selectedAgentRoom.round?.status, "complete");
      assert.equal(response.payload.selectedAgentRoom.round?.failedParticipantIds?.length || 0, 0);
      return response.payload;
    }, { timeoutMs: 6000 });
    assert.equal(completed.selectedAgentRoom.round?.status, "complete");

    const retryLiveEvent = await stream.waitForEvent(
      "live",
      (payload) =>
        payload.selectedAgentRoom?.messages?.some(
          (entry) =>
            entry.note === "council retry / 2 participants" &&
            entry.role === "user"
        ),
      6000
    );
    assert.equal(
      retryLiveEvent.data.selectedAgentRoom.messages.some(
        (entry) => entry.note === "council retry / 2 participants" && entry.role === "user"
      ),
      true
    );
  } finally {
    await stream.close();
    await server.close();
  }
});

test("server integration keeps council retry recoverable after a second partial failure", async () => {
  const server = await startTestServer({
    env: {
      DEXTUNNEL_FAKE_AGENT_ROOM: "1",
      DEXTUNNEL_FAKE_AGENT_ROOM_FAILURES: "gemini:timeout*2"
    }
  });

  try {
    const initial = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
    assert.equal(initial.ok, true);
    const threadId = initial.payload.selectedThreadId;

    const enabled = await requestSurfaceJson(server, "remote", "/api/codex-app-server/agent-room", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "enable",
        threadId
      })
    });
    assert.equal(enabled.ok, true);

    const startRound = async (action) =>
      requestSurfaceJson(server, "remote", "/api/codex-app-server/agent-room", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          threadId,
          ...(action === "send" ? { text: "Keep failing once more, then recover." } : {})
        })
      });

    const started = await startRound("send");
    assert.equal(started.ok, true);

    const firstPartial = await waitFor(async () => {
      const response = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
      assert.equal(response.ok, true);
      assert.equal(response.payload.selectedAgentRoom.round?.status, "partial");
      return response.payload;
    }, { timeoutMs: 6000 });
    assert.equal(firstPartial.selectedAgentRoom.round?.canRetryFailed, true);

    const retriedOnce = await startRound("retry");
    assert.equal(retriedOnce.ok, true);

    const secondPartial = await waitFor(async () => {
      const response = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
      assert.equal(response.ok, true);
      assert.equal(response.payload.selectedAgentRoom.round?.status, "partial");
      assert.equal(response.payload.selectedAgentRoom.round?.retryCount, 1);
      return response.payload;
    }, { timeoutMs: 6000 });
    assert.equal(secondPartial.selectedAgentRoom.round?.canRetryFailed, true);

    const retriedTwice = await startRound("retry");
    assert.equal(retriedTwice.ok, true);

    const completed = await waitFor(async () => {
      const response = await requestSurfaceJson(server, "remote", "/api/codex-app-server/live-state");
      assert.equal(response.ok, true);
      assert.equal(response.payload.selectedAgentRoom.round?.status, "complete");
      assert.equal(response.payload.selectedAgentRoom.round?.retryCount, 2);
      return response.payload;
    }, { timeoutMs: 6000 });
    assert.equal(completed.selectedAgentRoom.round?.status, "complete");
  } finally {
    await server.close();
  }
});
