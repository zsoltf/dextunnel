import test from "node:test";
import assert from "node:assert/strict";

import { handleBridgeApiRequest } from "../src/lib/bridge-api-handler.mjs";

function createDeps(overrides = {}) {
  return {
    CONTROL_LEASE_TTL_MS: 1000,
    accessClientId: (access) => access.clientId,
    appServerState: {},
    applyCompanionWakeupAction: () => ({ message: "ok" }),
    applyLiveControlAction: () => ({ lease: null }),
    applySurfacePresenceUpdate: () => false,
    broadcast: () => {},
    buildBridgeStatus: () => ({ watcherConnected: true }),
    buildInstallPreflight: async () => ({ status: "ready" }),
    buildLivePayload: () => ({ selectedThreadId: "thr_dextunnel" }),
    buildLiveTurnChanges: () => ({ items: [] }),
    canServeSurfaceBootstrap: () => true,
    clearDebugPendingInteraction: () => ({}),
    codexAppServer: {
      getLatestThreadForCwd: async () => null,
      readThread: async () => null,
      sendText: async () => null
    },
    createThreadSelection: async () => ({ ok: true }),
    decorateSnapshot: (snapshot) => snapshot,
    devToolsEnabled: false,
    exposeHostSurface: false,
    ensureRemoteControlLease: () => {},
    errorStatusCode: (error, fallback = 500) => Number(error?.statusCode || fallback),
    getCachedRepoChanges: async () => ({ items: [] }),
    getControlLeaseForThread: () => null,
    hasWatcherController: () => true,
    interruptSelectedThread: async () => ({ ok: true }),
    invalidateRepoChangesCache: () => {},
    issueSurfaceBootstrap: (surface) => ({ accessToken: `${surface}-token`, clientId: `${surface}-1`, expiresAt: "2026-03-21T00:00:00Z", surface }),
    liveState: {
      pendingInteraction: null,
      selectedProjectCwd: "/tmp/project",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null,
      surfacePresenceByClientId: {},
      threads: [],
      turnDiff: null,
      writeLock: null
    },
    loadTranscriptHistoryPage: async () => ({
      hasMore: false,
      items: [],
      nextBeforeIndex: null,
      totalCount: 0
    }),
    mapThreadToCompanionSnapshot: (thread) => thread,
    mockAdapter: null,
    nowIso: () => "2026-03-19T00:00:00.000Z",
    openThreadInCodex: async (threadId) => ({ deeplink: `codex://threads/${threadId}` }),
    persistImageAttachments: async () => [],
    readJsonBody: async () => ({}),
    recordControlEvent: () => {},
    refreshLiveState: async () => ({ ok: true }),
    refreshThreads: async () => {},
    scheduleSnapshotRefresh: () => {},
    rememberTurnOrigin: () => {},
    requireSurfaceCapability: () => ({ clientId: "signed-surface", surface: "remote", capabilities: [] }),
    resolvePendingInteraction: async () => {},
    resolveSurfaceAccess: () => ({ clientId: "signed-surface", surface: "remote", capabilities: ["control_remote"] }),
    restartWatcher: async () => {},
    runtimeConfig: {
      appServerListenUrl: "ws://127.0.0.1:4321",
      codexBinaryPath: "codex",
      host: "127.0.0.1",
      port: 4317,
      runtimeProfile: "default"
    },
    scheduleControlLeaseExpiry: () => {},
    sendJson: () => {},
    setDebugCompanionWakeup: () => ({}),
    setDebugPendingInteraction: () => ({}),
    setSelection: async () => ({ ok: true }),
    store: { applyCommand: () => ({}), getState: () => ({ ok: true }) },
    streamState: () => {},
    summonCompanionWakeup: () => ({ message: "ok" }),
    updateAgentRoom: async () => ({ message: "ok" }),
    ...overrides
  };
}

test("bridge api handler serves live state through the extracted route seam", async () => {
  const sent = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "GET" },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/live-state"),
    deps: createDeps({
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, [
    {
      payload: { selectedThreadId: "thr_dextunnel" },
      statusCode: 200
    }
  ]);
});

test("bridge api handler serves install preflight without surface auth", async () => {
  const sent = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "GET" },
    res: {},
    url: new URL("http://localhost/api/preflight?warmup=1"),
    deps: createDeps({
      buildInstallPreflight: async ({ warmup }) => ({
        status: warmup ? "ready" : "warning",
        summary: "All clear."
      }),
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, [
    {
      payload: {
        status: "ready",
        summary: "All clear."
      },
      statusCode: 200
    }
  ]);
});

test("bridge api handler serves native remote bootstrap without surface auth", async () => {
  const sent = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "GET", socket: { remoteAddress: "192.168.64.10" } },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/bootstrap?surface=remote"),
    deps: createDeps({
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, [
    {
      payload: {
        accessToken: "remote-token",
        clientId: "remote-1",
        expiresAt: "2026-03-21T00:00:00Z",
        surface: "remote"
      },
      statusCode: 200
    }
  ]);
});

test("bridge api handler serves agent bootstrap without surface auth", async () => {
  const sent = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "GET", socket: { remoteAddress: "192.168.64.10" } },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/bootstrap?surface=agent"),
    deps: createDeps({
      issueSurfaceBootstrap: (surface) => ({
        accessToken: `${surface}-token`,
        capabilities: ["read_room", "send_turn"],
        clientId: `${surface}-1`,
        expiresAt: "2026-03-21T00:00:00Z",
        issuedAt: "2026-03-20T00:00:00Z",
        surface
      }),
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, [
    {
      payload: {
        accessToken: "agent-token",
        capabilities: ["read_room", "send_turn"],
        clientId: "agent-1",
        expiresAt: "2026-03-21T00:00:00Z",
        issuedAt: "2026-03-20T00:00:00Z",
        surface: "agent"
      },
      statusCode: 200
    }
  ]);
});

test("bridge api handler blocks host bootstrap for non-loopback clients by default", async () => {
  const sent = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "GET", socket: { remoteAddress: "192.168.64.10" } },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/bootstrap?surface=host"),
    deps: createDeps({
      canServeSurfaceBootstrap: () => false,
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, [
    {
      payload: {
        error: "Host surface bootstrap is restricted to loopback unless DEXTUNNEL_EXPOSE_HOST_SURFACE is enabled."
      },
      statusCode: 403
    }
  ]);
});

test("bridge api handler derives selection authority from the signed surface access", async () => {
  const calls = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "POST" },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/selection"),
    deps: createDeps({
      readJsonBody: async () => ({
        clientId: "spoofed-body-client",
        threadId: "thr_marketing"
      }),
      requireSurfaceCapability: () => ({
        capabilities: ["select_room"],
        clientId: "signed-remote-client",
        surface: "remote"
      }),
      sendJson: () => {},
      setSelection: async (payload) => {
        calls.push(payload);
        return { ok: true, state: { selectedThreadId: payload.threadId } };
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [
    {
      clientId: "signed-remote-client",
      cwd: null,
      source: "remote",
      threadId: "thr_marketing"
    }
  ]);
});

test("bridge api handler creates a fresh thread selection with the signed surface access", async () => {
  const sent = [];
  const calls = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "POST" },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/thread"),
    deps: createDeps({
      readJsonBody: async () => ({
        clientId: "spoofed-body-client",
        cwd: "/tmp/codex/new-thread"
      }),
      requireSurfaceCapability: () => ({
        capabilities: ["select_room"],
        clientId: "signed-remote-client",
        surface: "remote"
      }),
      createThreadSelection: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          source: payload.source,
          state: {
            selectedThreadId: "thr_new"
          },
          thread: {
            id: "thr_new",
            cwd: payload.cwd
          }
        };
      },
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [
    {
      clientId: "signed-remote-client",
      cwd: "/tmp/codex/new-thread",
      source: "remote"
    }
  ]);
  assert.deepEqual(sent, [
    {
      payload: {
        ok: true,
        source: "remote",
        state: {
          selectedThreadId: "thr_new"
        },
        thread: {
          id: "thr_new",
          cwd: "/tmp/codex/new-thread"
        }
      },
      statusCode: 200
    }
  ]);
});

test("bridge api handler prefers the richer selected live snapshot on thread readback", async () => {
  const sent = [];
  const lightweightThread = {
    id: "thr_fresh",
    cwd: "/tmp/codex/new-thread",
    turns: []
  };
  const lightweightSnapshot = {
    thread: {
      id: "thr_fresh",
      cwd: "/tmp/codex/new-thread",
      activeTurnStatus: null,
      lastTurnStatus: null
    },
    transcript: [
      { role: "user", text: "Fresh thread integration send" }
    ],
    transcriptCount: 1
  };
  const richerSelectedSnapshot = {
    thread: {
      id: "thr_fresh",
      cwd: "/tmp/codex/new-thread",
      activeTurnStatus: "inProgress",
      lastTurnStatus: "inProgress"
    },
    transcript: [
      { role: "user", text: "Fresh thread integration send" },
      { role: "assistant", text: "Thinking..." }
    ],
    transcriptCount: 2
  };

  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "GET" },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/thread?threadId=thr_fresh&limit=40"),
    deps: createDeps({
      buildSelectedThreadSnapshot: async () => lightweightSnapshot,
      codexAppServer: {
        readThread: async (threadId, includeTurns) => {
          assert.equal(threadId, "thr_fresh");
          assert.equal(includeTurns, false);
          return lightweightThread;
        }
      },
      liveState: {
        pendingInteraction: null,
        selectedProjectCwd: "/tmp/codex/new-thread",
        selectedThreadId: "thr_fresh",
        selectedThreadSnapshot: richerSelectedSnapshot,
        surfacePresenceByClientId: {},
        threads: [],
        turnDiff: null,
        writeLock: null
      },
      mergeSelectedThreadSnapshot: (snapshot, selectedSnapshot) => ({
        ...selectedSnapshot,
        transcript: [
          ...(snapshot?.transcript || []),
          ...((selectedSnapshot?.transcript || []).slice(snapshot?.transcript?.length || 0))
        ],
        transcriptCount: Math.max(snapshot?.transcriptCount || 0, selectedSnapshot?.transcriptCount || 0)
      }),
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, [
    {
      payload: {
        threadId: "thr_fresh",
        found: true,
        snapshot: {
          thread: {
            id: "thr_fresh",
            cwd: "/tmp/codex/new-thread",
            activeTurnStatus: "inProgress",
            lastTurnStatus: "inProgress"
          },
          transcript: [
            { role: "user", text: "Fresh thread integration send" },
            { role: "assistant", text: "Thinking..." }
          ],
          transcriptCount: 2
        }
      },
      statusCode: 200
    }
  ]);
});

test("bridge api handler serves transcript history for the selected thread", async () => {
  const sent = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "GET" },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/transcript-history?visibleCount=12&limit=40"),
    deps: createDeps({
      loadTranscriptHistoryPage: async (params) => {
        assert.deepEqual(params, {
          beforeIndex: null,
          limit: "40",
          threadId: "thr_dextunnel",
          visibleCount: "12"
        });
        return {
          hasMore: true,
          items: [{ id: "entry-1", text: "older" }],
          nextBeforeIndex: 51,
          totalCount: 91
        };
      },
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, [
    {
      payload: {
        hasMore: true,
        items: [{ id: "entry-1", text: "older" }],
        nextBeforeIndex: 51,
        totalCount: 91
      },
      statusCode: 200
    }
  ]);
});

test("bridge api handler returns false for paths outside the bridge api", async () => {
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "GET" },
    res: {},
    url: new URL("http://localhost/remote.html"),
    deps: createDeps()
  });

  assert.equal(handled, false);
});

test("bridge api handler preserves auth errors on the changes route", async () => {
  const sent = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "GET" },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/changes"),
    deps: createDeps({
      requireSurfaceCapability: () => {
        throw Object.assign(new Error("Dextunnel surface access is missing or expired."), {
          statusCode: 403
        });
      },
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.deepEqual(sent, [
    {
      payload: { error: "Dextunnel surface access is missing or expired." },
      statusCode: 403
    }
  ]);
});

test("bridge api handler returns a compact send response instead of echoing the full thread", async () => {
  const sent = [];
  const sendCalls = [];
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "POST" },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/turn"),
    deps: createDeps({
      codexAppServer: {
        sendText: async (payload) => {
          sendCalls.push(payload);
          return {
          mode: "start",
          snapshot: {
            thread: {
              cwd: "/tmp/project",
              id: "thr_dextunnel",
              name: "dextunnel",
              preview: "latest reply",
              source: "vscode",
              status: "completed",
              updatedAt: "2026-03-22T00:00:00.000Z"
            },
            transcript: []
          },
          thread: {
            cwd: "/tmp/project",
            id: "thr_dextunnel",
            turns: [{ id: "turn_1", items: [{ type: "userMessage", content: [{ type: "text", text: "huge" }] }] }]
          },
          turn: {
            id: "turn_1",
            startedAt: "2026-03-22T00:00:00.000Z",
            status: "completed",
            updatedAt: "2026-03-22T00:00:01.000Z"
          }
        };
        }
      },
      readJsonBody: async () => ({
        text: "hello",
        threadId: "thr_dextunnel"
      }),
      requireSurfaceCapability: () => ({
        capabilities: ["send_turn", "control_remote"],
        clientId: "signed-remote-client",
        surface: "remote"
      }),
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.equal(sent[0].statusCode, 200);
  assert.equal(sent[0].payload.ok, true);
  assert.equal(sent[0].payload.thread.id, "thr_dextunnel");
  assert.equal(sent[0].payload.thread.turns, undefined);
  assert.equal(sent[0].payload.turn.id, "turn_1");
  assert.equal(sendCalls[0].waitForCompletion, false);
});

test("bridge api handler reuses the current watcher after send and merges duplicate snapshot copies", async () => {
  const sent = [];
  let restartCalls = 0;
  let scheduledRefreshDelay = null;
  const liveState = {
    pendingInteraction: null,
    selectedProjectCwd: "/tmp/project",
    selectedThreadId: "thr_dextunnel",
    selectedThreadSnapshot: {
      thread: { id: "thr_dextunnel", cwd: "/tmp/project", name: "dextunnel" },
      transcript: [
        {
          itemId: "item_user_1",
          kind: "message",
          role: "user",
          text: "hello from the web",
          timestamp: "2026-03-22T20:51:00.100Z",
          turnId: "turn_1"
        }
      ],
      transcriptCount: 1
    },
    surfacePresenceByClientId: {},
    threads: [],
    turnDiff: null,
    watcherConnected: true,
    writeLock: null
  };
  const handled = await handleBridgeApiRequest({
    req: { headers: {}, method: "POST" },
    res: {},
    url: new URL("http://localhost/api/codex-app-server/turn"),
    deps: createDeps({
      codexAppServer: {
        sendText: async () => ({
          mode: "start",
          snapshot: {
            thread: {
              cwd: "/tmp/project",
              id: "thr_dextunnel",
              name: "dextunnel",
              preview: "latest reply",
              source: "vscode",
              status: "completed",
              updatedAt: "2026-03-22T00:00:00.000Z"
            },
            transcript: [
              {
                kind: "message",
                role: "user",
                text: "hello from the web",
                timestamp: "2026-03-22T20:51:00.900Z"
              }
            ]
          },
          thread: {
            cwd: "/tmp/project",
            id: "thr_dextunnel"
          },
          turn: {
            id: "turn_1",
            startedAt: "2026-03-22T00:00:00.000Z",
            status: "completed",
            updatedAt: "2026-03-22T00:00:01.000Z"
          }
        })
      },
      liveState,
      mergeSelectedThreadSnapshot: (previousSnapshot, nextSnapshot) => ({
        ...nextSnapshot,
        transcript: [previousSnapshot.transcript[0]]
      }),
      readJsonBody: async () => ({
        text: "hello from the web",
        threadId: "thr_dextunnel"
      }),
      requireSurfaceCapability: () => ({
        capabilities: ["send_turn", "control_remote"],
        clientId: "signed-remote-client",
        surface: "remote"
      }),
      restartWatcher: async () => {
        restartCalls += 1;
      },
      scheduleSnapshotRefresh: (delay) => {
        scheduledRefreshDelay = delay;
      },
      sendJson: (_res, statusCode, payload) => {
        sent.push({ payload, statusCode });
      }
    })
  });

  assert.equal(handled, true);
  assert.equal(sent[0].statusCode, 200);
  assert.equal(sent[0].payload.snapshot.transcript.length, 1);
  assert.equal(restartCalls, 0);
  assert.equal(scheduledRefreshDelay, 120);
});
