import { performance } from "node:perf_hooks";

function parseArgs(argv) {
  const options = {
    baseUrl: "http://127.0.0.1:4317",
    json: false,
    probeSend: false,
    surface: "remote"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base-url" && argv[index + 1]) {
      options.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--surface" && argv[index + 1]) {
      options.surface = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--probe-send") {
      options.probeSend = true;
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      printHelpAndExit(0);
    }
  }

  return options;
}

function printHelpAndExit(code = 0) {
  console.log("Usage: node src/bin/mobile-transport-smoke.mjs [--base-url http://127.0.0.1:4317] [--surface remote|host] [--probe-send] [--json]");
  process.exit(code);
}

async function measuredJson(url, init = {}) {
  const startedAt = performance.now();
  const response = await fetch(url, init);
  const rawText = await response.text();
  const elapsedMs = Math.round(performance.now() - startedAt);
  const bytes = Buffer.byteLength(rawText || "", "utf8");
  const payload = rawText ? JSON.parse(rawText) : null;
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || response.statusText || "Request failed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return {
    bytes,
    elapsedMs,
    payload,
    status: response.status,
    url
  };
}

function surfaceHeaders(token) {
  return {
    "x-dextunnel-surface-token": token
  };
}

function summarizeMetric(name, result) {
  return {
    bytes: result.bytes,
    elapsedMs: result.elapsedMs,
    name,
    status: result.status
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = new URL(options.baseUrl);
  const bootstrapUrl = new URL("/api/codex-app-server/bootstrap", baseUrl);
  bootstrapUrl.searchParams.set("surface", options.surface);

  const bootstrap = await measuredJson(bootstrapUrl);
  const accessToken = bootstrap.payload?.accessToken;
  if (!accessToken) {
    throw new Error("Bootstrap did not return a surface token.");
  }

  const metrics = [summarizeMetric("bootstrap", bootstrap)];

  const liveState = await measuredJson(new URL("/api/codex-app-server/live-state", baseUrl), {
    headers: surfaceHeaders(accessToken)
  });
  metrics.push(summarizeMetric("live-state", liveState));

  const threads = await measuredJson(new URL("/api/codex-app-server/threads", baseUrl), {
    headers: surfaceHeaders(accessToken)
  });
  metrics.push(summarizeMetric("threads", threads));

  const refresh = await measuredJson(new URL("/api/codex-app-server/refresh", baseUrl), {
    headers: surfaceHeaders(accessToken),
    method: "POST"
  });
  metrics.push(summarizeMetric("refresh", refresh));

  const selectedThreadId = refresh.payload?.state?.selectedThreadId || liveState.payload?.selectedThreadId || null;
  const selectedProjectCwd = refresh.payload?.state?.selectedProjectCwd || liveState.payload?.selectedProjectCwd || null;

  if (selectedThreadId || selectedProjectCwd) {
    const selection = await measuredJson(new URL("/api/codex-app-server/selection", baseUrl), {
      body: JSON.stringify({
        cwd: selectedProjectCwd,
        threadId: selectedThreadId
      }),
      headers: {
        ...surfaceHeaders(accessToken),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    metrics.push(summarizeMetric("selection", selection));
  }

  if (options.probeSend) {
    if (!selectedThreadId) {
      throw new Error("Probe send requires a selected thread.");
    }
    const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
    const claim = await measuredJson(new URL("/api/codex-app-server/control", baseUrl), {
      body: JSON.stringify({
        action: "claim",
        reason: "transport_smoke",
        threadId: selectedThreadId
      }),
      headers: {
        ...surfaceHeaders(accessToken),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    metrics.push(summarizeMetric("claim", claim));

    const send = await measuredJson(new URL("/api/codex-app-server/turn", baseUrl), {
      body: JSON.stringify({
        attachments: [],
        text: `TRANSPORT_SMOKE_PROBE_${stamp}. Reply with exactly TRANSPORT_SMOKE_ACK_${stamp}.`,
        threadId: selectedThreadId
      }),
      headers: {
        ...surfaceHeaders(accessToken),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    metrics.push(summarizeMetric("send", send));

    const release = await measuredJson(new URL("/api/codex-app-server/control", baseUrl), {
      body: JSON.stringify({
        action: "release",
        reason: "transport_smoke_cleanup",
        threadId: selectedThreadId
      }),
      headers: {
        ...surfaceHeaders(accessToken),
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    metrics.push(summarizeMetric("release", release));
  }

  const summary = {
    metrics,
    selectedProjectCwd,
    selectedThreadId,
    surface: options.surface
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  for (const metric of metrics) {
    console.log(`[${options.surface}] ${metric.name} elapsedMs=${metric.elapsedMs} bytes=${metric.bytes} status=${metric.status}`);
  }
  if (selectedThreadId) {
    console.log(`[${options.surface}] selectedThreadId=${selectedThreadId}`);
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
