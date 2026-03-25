import test from "node:test";
import assert from "node:assert/strict";

import { createThreadSyncStateService } from "../src/lib/thread-sync-state.mjs";

function createService(overrides = {}) {
  const calls = [];
  const liveState = overrides.liveState || {
    lastError: null,
    lastSyncAt: null,
    selectedProjectCwd: "/tmp/codex/dextunnel",
    selectedThreadId: "thr_missing",
    selectedThreadSnapshot: null,
    selectionSource: "remote",
    threads: [],
    turnDiff: { threadId: "thr_missing" }
  };
  const codexAppServer = overrides.codexAppServer || {
    listThreads: async () => [],
    readThread: async () => null,
    startThread: async () => ({ id: "thr_new" })
  };

  return {
    calls,
    liveState,
    service: createThreadSyncStateService({
      broadcast: (event, payload) => calls.push(["broadcast", event, payload]),
      buildLivePayload: () => ({ selectedThreadId: liveState.selectedThreadId }),
      clearControlLease: (payload) => calls.push(["clearControlLease", payload]),
      codexAppServer,
      fallbackLiveSourceKinds: ["vscode", "cli"],
      liveState,
      loadThreadAgentRoomState: async (threadId) => calls.push(["loadAgentRoom", threadId]),
      mapThreadToCompanionSnapshot: (thread, { limit }) => ({
        thread: {
          cwd: thread.cwd,
          id: thread.id,
          name: thread.name
        },
        transcript: thread.transcript || [],
        transcriptCount: limit
      }),
      nowIso: () => "2026-03-20T16:30:00.000Z",
      preferredLiveSourceKinds: ["vscode"],
      processCwd: () => "/tmp/codex/default",
      summarizeThread: (thread) => ({ id: thread.id, name: thread.name, cwd: thread.cwd }),
      ...overrides
    })
  };
}

test("refreshThreads prefers vscode threads and falls back when needed", async () => {
  const requests = [];
  const { liveState, service } = createService({
    codexAppServer: {
      listThreads: async (params) => {
        requests.push(params.sourceKinds.join(","));
        return params.sourceKinds.length === 1
          ? []
          : [{ id: "thr_cli", name: "CLI", cwd: "/tmp/codex/cli" }];
      },
      readThread: async () => null,
      startThread: async () => ({ id: "thr_new" })
    },
    liveState: {
      lastError: "old",
      selectedProjectCwd: "/tmp/codex/cli",
      selectedThreadId: "thr_missing",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [],
      turnDiff: null
    }
  });

  await service.refreshThreads({ broadcastUpdate: false });

  assert.deepEqual(requests, ["vscode", "vscode,cli"]);
  assert.equal(liveState.selectedThreadId, "thr_cli");
  assert.equal(liveState.selectedProjectCwd, "/tmp/codex/cli");
  assert.equal(liveState.lastError, null);
});

test("refreshThreads uses lightweight summaries so previews reflect latest room state without full thread reads", async () => {
  const readRequests = [];
  const { liveState, service } = createService({
    codexAppServer: {
      listThreads: async () => [
        { id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel", preview: "$codex-repo-bootstrap" },
        { id: "thr_nix", name: "nix", cwd: "/tmp/codex/nix", preview: "hello from long ago" }
      ],
      readThread: async (threadId) => {
        readRequests.push(threadId);
        return null;
      },
      startThread: async () => ({ id: "thr_new" })
    },
    liveState: {
      lastError: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [],
      turnDiff: null
    },
    buildThreadSummary: async (thread) => ({
      cwd: thread.cwd,
      id: thread.id,
      name: thread.name,
      openingPreview: thread.id === "thr_dextunnel" ? "opening message" : "hey nix, welcome",
      preview: thread.id === "thr_dextunnel" ? "latest assistant reply" : "nix latest update"
    })
  });

  await service.refreshThreads({ broadcastUpdate: false });

  assert.deepEqual(readRequests, []);
  assert.equal(liveState.threads[0].preview, "latest assistant reply");
  assert.equal(liveState.threads[1].preview, "nix latest update");
});

test("refreshThreads preserves the currently selected fresh thread when the room list has not caught up yet", async () => {
  const { liveState, service } = createService({
    codexAppServer: {
      listThreads: async () => [
        { id: "thr_old", name: "older room", cwd: "/tmp/codex/old" }
      ],
      readThread: async () => null,
      startThread: async () => ({ id: "thr_new" })
    },
    liveState: {
      lastError: null,
      selectedProjectCwd: "/tmp/codex/new-thread",
      selectedThreadId: "thr_new",
      selectedThreadSnapshot: {
        thread: {
          id: "thr_new",
          name: "fresh room",
          cwd: "/tmp/codex/new-thread",
          lastTurnStatus: "inProgress"
        },
        transcript: [],
        transcriptCount: 0
      },
      selectionSource: "remote",
      threads: [
        { id: "thr_new", name: "fresh room", cwd: "/tmp/codex/new-thread" },
        { id: "thr_old", name: "older room", cwd: "/tmp/codex/old" }
      ],
      turnDiff: null
    }
  });

  await service.refreshThreads({ broadcastUpdate: false });

  assert.equal(liveState.selectedThreadId, "thr_new");
  assert.equal(liveState.threads[0].id, "thr_new");
  assert.equal(liveState.threads[1].id, "thr_old");
});

test("refreshSelectedThreadSnapshot can use a lightweight selected-thread reader and snapshot builder", async () => {
  const readRequests = [];
  const { calls, liveState, service } = createService({
    codexAppServer: {
      listThreads: async () => [],
      readThread: async (threadId, includeTurns) => {
        readRequests.push([threadId, includeTurns]);
        return {
          cwd: "/tmp/codex/dextunnel",
          id: threadId,
          name: "dextunnel",
          path: "/tmp/thread.jsonl",
          preview: "latest assistant reply",
          status: { type: "idle" },
          transcript: []
        };
      },
      startThread: async () => ({ id: "thr_new" })
    },
    buildSelectedThreadSnapshot: async (thread) => ({
      thread: {
        cwd: thread.cwd,
        id: thread.id,
        name: thread.name,
        preview: thread.preview
      },
      transcript: [{ role: "assistant", text: "latest assistant reply" }],
      transcriptCount: 1
    }),
    liveState: {
      lastError: "old",
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [],
      turnDiff: { threadId: "thr_dextunnel" }
    },
    readSelectedThread: async (threadId) => ({
      cwd: "/tmp/codex/dextunnel",
      id: threadId,
      name: "dextunnel",
      path: "/tmp/thread.jsonl",
      preview: "latest assistant reply",
      status: { type: "idle" }
    })
  });

  await service.refreshSelectedThreadSnapshot({ broadcastUpdate: false });

  assert.deepEqual(readRequests, []);
  assert.deepEqual(calls, [["loadAgentRoom", "thr_dextunnel"]]);
  assert.equal(liveState.selectedThreadSnapshot.transcript[0].text, "latest assistant reply");
  assert.equal(liveState.lastError, null);
});

test("createThreadSelectionState uses a lightweight snapshot for a brand-new empty thread", async () => {
  const readRequests = [];
  const createdThread = {
    cwd: "/tmp/codex/new",
    id: "thr_new",
    name: "New session",
    path: "/tmp/codex/new/.codex/thr_new.jsonl",
    preview: null,
    turns: []
  };
  const { liveState, service } = createService({
    codexAppServer: {
      listThreads: async () => [],
      readThread: async (threadId, includeTurns) => {
        readRequests.push([threadId, includeTurns]);
        assert.equal(includeTurns, false);
        return createdThread;
      },
      startThread: async () => createdThread
    },
    buildLightweightSelectedThreadSnapshot: async (thread, { limit }) => ({
      thread: {
        cwd: thread.cwd,
        id: thread.id,
        name: thread.name
      },
      transcript: [],
      transcriptCount: 0
    }),
    snapshotNeedsDeepHydration: () => true
  });

  const result = await service.createThreadSelectionState({
    cwd: "/tmp/codex/new",
    source: "remote"
  });

  assert.deepEqual(readRequests, [["thr_new", false]]);
  assert.equal(result.thread.id, "thr_new");
  assert.equal(result.snapshot.thread.id, "thr_new");
  assert.equal(result.snapshot.transcriptHydrating, false);
  assert.equal(liveState.selectedThreadSnapshot.thread.id, "thr_new");
  assert.equal(liveState.selectedThreadSnapshot.transcriptHydrating, false);
});

test("createThreadSelectionState falls back to the started thread when a new thread is not materialized yet", async () => {
  const createdThread = {
    cwd: "/tmp/codex/new",
    id: "thr_new",
    name: "New session",
    path: "/tmp/codex/new/.codex/thr_new.jsonl",
    preview: null,
    turns: []
  };
  const { liveState, service } = createService({
    codexAppServer: {
      listThreads: async () => [],
      readThread: async () => {
        throw new Error("thread thr_new is not materialized yet; includeTurns is unavailable before first user message");
      },
      startThread: async () => createdThread
    },
    buildLightweightSelectedThreadSnapshot: async (thread) => ({
      thread: {
        cwd: thread.cwd,
        id: thread.id,
        name: thread.name
      },
      transcript: [],
      transcriptCount: 0
    })
  });

  const result = await service.createThreadSelectionState({
    cwd: "/tmp/codex/new",
    source: "remote"
  });

  assert.equal(result.thread.id, "thr_new");
  assert.equal(liveState.selectedThreadId, "thr_new");
  assert.equal(liveState.selectedThreadSnapshot.thread.id, "thr_new");
  assert.equal(liveState.lastError, null);
});

test("prewarmThreadSnapshots skips the selected room and limits background warming", async () => {
  const warmed = [];
  const threadIndex = new Map([
    ["thr_selected", { cwd: "/tmp/codex/main", id: "thr_selected", name: "Selected" }],
    ["thr_same_project", { cwd: "/tmp/codex/main", id: "thr_same_project", name: "Same project" }],
    ["thr_active", { activeTurnId: "turn-1", cwd: "/tmp/codex/other", id: "thr_active", name: "Active elsewhere" }],
    ["thr_vscode", { cwd: "/tmp/codex/alt", id: "thr_vscode", name: "VSCode", source: "vscode" }],
    ["thr_tail", { cwd: "/tmp/codex/tail", id: "thr_tail", name: "Tail" }]
  ]);
  const { service } = createService({
    liveState: {
      lastError: null,
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/main",
      selectedThreadId: "thr_selected",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [...threadIndex.values()],
      turnDiff: null
    },
    readSelectedThread: async (threadId) => threadIndex.get(threadId) || null,
    buildSelectedThreadSnapshot: async (thread) => {
      warmed.push(thread.id);
      return {
        thread: {
          cwd: thread.cwd,
          id: thread.id,
          name: thread.name
        },
        transcript: [],
        transcriptCount: 0
      };
    }
  });

  await service.prewarmThreadSnapshots({ excludeThreadId: "thr_selected" });

  assert.equal(warmed.length, 3);
  assert.ok(!warmed.includes("thr_selected"));
});

test("prewarmThreadSnapshots reuses an in-flight snapshot when selection refresh needs the same room", async () => {
  let resolveSnapshot = null;
  const buildCalls = [];
  const thread = {
    cwd: "/tmp/codex/dextunnel",
    id: "thr_dextunnel",
    name: "dextunnel",
    path: "/tmp/thread.jsonl",
    preview: "latest assistant reply"
  };
  const { liveState, service } = createService({
    liveState: {
      lastError: null,
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [thread],
      turnDiff: null
    },
    readSelectedThread: async () => thread,
    buildSelectedThreadSnapshot: async (candidate) => {
      buildCalls.push(candidate.id);
      await new Promise((resolve) => {
        resolveSnapshot = resolve;
      });
      return {
        thread: {
          cwd: candidate.cwd,
          id: candidate.id,
          name: candidate.name
        },
        transcript: [{ role: "assistant", text: "ready" }],
        transcriptCount: 1
      };
    }
  });

  const prewarmPromise = service.prewarmThreadSnapshots({ maxThreads: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const refreshPromise = service.refreshSelectedThreadSnapshot({ broadcastUpdate: false });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(buildCalls, ["thr_dextunnel"]);

  resolveSnapshot?.();
  await Promise.all([prewarmPromise, refreshPromise]);

  assert.equal(liveState.selectedThreadSnapshot.thread.id, "thr_dextunnel");
  assert.deepEqual(buildCalls, ["thr_dextunnel"]);
});

test("refreshSelectedThreadSnapshot hydrates the selected thread and clears stale errors", async () => {
  const { calls, liveState, service } = createService({
    codexAppServer: {
      listThreads: async () => [],
      readThread: async (threadId) => ({
        cwd: "/tmp/codex/dextunnel",
        id: threadId,
        name: "dextunnel",
        transcript: [{ role: "assistant", text: "ready" }]
      }),
      startThread: async () => ({ id: "thr_new" })
    },
    liveState: {
      lastError: "old",
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [],
      turnDiff: { threadId: "thr_dextunnel" }
    }
  });

  await service.refreshSelectedThreadSnapshot({ broadcastUpdate: false });

  assert.deepEqual(calls, [["loadAgentRoom", "thr_dextunnel"]]);
  assert.equal(liveState.selectedThreadSnapshot.thread.id, "thr_dextunnel");
  assert.equal(liveState.selectedThreadSnapshot.transcript[0].text, "ready");
  assert.equal(liveState.lastSyncAt, "2026-03-20T16:30:00.000Z");
  assert.equal(liveState.lastError, null);
});

test("refreshSelectedThreadSnapshot shows a quick tail immediately while full hydration continues in background", async () => {
  let resolveFullSnapshot = null;
  const thread = {
    cwd: "/tmp/codex/dextunnel",
    id: "thr_dextunnel",
    name: "dextunnel",
    path: "/tmp/thread.jsonl"
  };
  const { calls, liveState, service } = createService({
    codexAppServer: {
      listThreads: async () => [],
      readThread: async () => thread,
      startThread: async () => ({ id: "thr_new" })
    },
    liveState: {
      lastError: null,
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [{ id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" }],
      turnDiff: null
    },
    buildLightweightSelectedThreadSnapshot: async () => ({
      thread: { cwd: thread.cwd, id: thread.id, name: thread.name },
      transcript: [{ role: "assistant", text: "quick tail" }],
      transcriptCount: 1
    }),
    buildSelectedThreadSnapshot: async () => {
      await new Promise((resolve) => {
        resolveFullSnapshot = resolve;
      });
      return {
        thread: { cwd: thread.cwd, id: thread.id, name: thread.name },
        transcript: [
          { role: "assistant", text: "older context" },
          { role: "assistant", text: "quick tail" }
        ],
        transcriptCount: 2
      };
    },
    snapshotNeedsDeepHydration: () => true
  });

  const outcome = await Promise.race([
    service.refreshSelectedThreadSnapshot().then(() => "resolved"),
    new Promise((resolve) => setTimeout(() => resolve("timed-out"), 0))
  ]);

  assert.equal(outcome, "resolved");
  assert.deepEqual(calls, [
    ["loadAgentRoom", "thr_dextunnel"],
    ["broadcast", "live", { selectedThreadId: "thr_dextunnel" }]
  ]);
  assert.equal(liveState.selectedThreadSnapshot.transcriptHydrating, true);
  assert.deepEqual(
    liveState.selectedThreadSnapshot.transcript.map((entry) => entry.text),
    ["quick tail"]
  );

  resolveFullSnapshot?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(liveState.selectedThreadSnapshot.transcriptHydrating, false);
  assert.deepEqual(
    [...liveState.selectedThreadSnapshot.transcript.map((entry) => entry.text)].sort(),
    ["older context", "quick tail"]
  );
});

test("refreshSelectedThreadSnapshot updates the room list with hydrated thread summary fields", async () => {
  const { liveState, service } = createService({
    codexAppServer: {
      listThreads: async () => [],
      readThread: async (threadId) => ({
        cwd: "/tmp/codex/dextunnel",
        id: threadId,
        name: "dextunnel",
        transcript: [{ role: "user", text: "opening message" }]
      }),
      startThread: async () => ({ id: "thr_new" })
    },
    liveState: {
      lastError: null,
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [{ id: "thr_dextunnel", name: "old", cwd: "/tmp/codex/dextunnel", preview: "latest" }],
      turnDiff: null
    },
    summarizeThread: (thread) => ({
      cwd: thread.cwd,
      id: thread.id,
      name: thread.name,
      openingPreview: thread.transcript?.[0]?.text || null,
      preview: "latest"
    })
  });

  await service.refreshSelectedThreadSnapshot({ broadcastUpdate: false });

  assert.equal(liveState.threads[0].name, "dextunnel");
  assert.equal(liveState.threads[0].openingPreview, "opening message");
  assert.equal(liveState.threads[0].preview, "latest");
});

test("refreshSelectedThreadSnapshot preserves visible history when a refreshed snapshot only contains the compacted tail", async () => {
  const { liveState, service } = createService({
    liveState: {
      lastError: null,
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: {
        thread: { id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" },
        transcript: [
          { role: "user", text: "before compaction" },
          { role: "assistant", text: "still visible before compaction" }
        ],
        transcriptCount: 2
      },
      selectionSource: "remote",
      threads: [{ id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" }],
      turnDiff: null
    },
    readSelectedThread: async (threadId) => ({
      cwd: "/tmp/codex/dextunnel",
      id: threadId,
      name: "dextunnel"
    }),
    buildSelectedThreadSnapshot: async () => ({
      thread: { id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" },
      transcript: [
        { role: "system", kind: "context_compaction", text: "Context compacted." },
        { role: "assistant", text: "after compaction reply" }
      ],
      transcriptCount: 2
    })
  });

  await service.refreshSelectedThreadSnapshot({ broadcastUpdate: false });

  assert.deepEqual(
    liveState.selectedThreadSnapshot.transcript.map((entry) => entry.text),
    [
      "before compaction",
      "still visible before compaction",
      "Context compacted.",
      "after compaction reply"
    ]
  );
});

test("refreshSelectedThreadSnapshot dedupes the same turn when live items and session-log items overlap", async () => {
  const { liveState, service } = createService({
    liveState: {
      lastError: null,
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: {
        thread: { id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" },
        transcript: [
          {
            itemId: "item_user_1",
            kind: "message",
            role: "user",
            text: "hello from the web",
            timestamp: "2026-03-22T20:51:00.100Z",
            turnId: "turn_remote_1"
          },
          {
            itemId: "item_agent_1",
            kind: "message",
            role: "assistant",
            text: "Received. The web send path is working on this thread.",
            timestamp: "2026-03-22T20:52:00.100Z",
            turnId: "turn_remote_1"
          }
        ],
        transcriptCount: 2
      },
      selectionSource: "remote",
      threads: [{ id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" }],
      turnDiff: null
    },
    readSelectedThread: async (threadId) => ({
      cwd: "/tmp/codex/dextunnel",
      id: threadId,
      name: "dextunnel"
    }),
    buildSelectedThreadSnapshot: async () => ({
      thread: { id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" },
      transcript: [
        {
          kind: "message",
          role: "user",
          text: "hello from the web",
          timestamp: "2026-03-22T20:51:00.900Z"
        },
        {
          kind: "message",
          role: "assistant",
          text: "Received. The web send path is working on this thread.",
          timestamp: "2026-03-22T20:52:00.900Z"
        }
      ],
      transcriptCount: 2
    })
  });

  await service.refreshSelectedThreadSnapshot({ broadcastUpdate: false });

  assert.deepEqual(
    liveState.selectedThreadSnapshot.transcript.map((entry) => entry.text),
    [
      "hello from the web",
      "Received. The web send path is working on this thread."
    ]
  );
});

test("refreshSelectedThreadSnapshot preserves richer live in-progress state when a lightweight refresh is thinner", async () => {
  const { liveState, service } = createService({
    liveState: {
      lastError: null,
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: {
        thread: {
          id: "thr_dextunnel",
          name: "dextunnel",
          cwd: "/tmp/codex/dextunnel",
          activeTurnId: "turn_live",
          activeTurnStatus: "inProgress",
          lastTurnId: "turn_live",
          lastTurnStatus: "inProgress",
          status: "inProgress"
        },
        transcript: [
          {
            itemId: "item_agent_live",
            kind: "message",
            role: "assistant",
            text: "The code path is stable and the runtime kernel is already in place.",
            timestamp: "2026-03-24T16:25:00.100Z",
            turnId: "turn_live"
          }
        ],
        transcriptCount: 1
      },
      selectionSource: "remote",
      threads: [{ id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" }],
      turnDiff: null
    },
    readSelectedThread: async (threadId) => ({
      cwd: "/tmp/codex/dextunnel",
      id: threadId,
      name: "dextunnel",
      path: "/tmp/thread.jsonl"
    }),
    buildLightweightSelectedThreadSnapshot: async () => ({
      thread: {
        id: "thr_dextunnel",
        name: "dextunnel",
        cwd: "/tmp/codex/dextunnel",
        activeTurnId: null,
        activeTurnStatus: null,
        lastTurnId: "turn_live",
        lastTurnStatus: "inProgress",
        status: "inProgress"
      },
      transcript: [
        {
          kind: "message",
          role: "assistant",
          text: "The",
          timestamp: "2026-03-24T16:25:00.900Z"
        }
      ],
      transcriptCount: 1
    }),
    snapshotNeedsDeepHydration: () => false
  });

  await service.refreshSelectedThreadSnapshot({ broadcastUpdate: false });

  assert.equal(liveState.selectedThreadSnapshot.thread.activeTurnId, "turn_live");
  assert.equal(liveState.selectedThreadSnapshot.thread.activeTurnStatus, "inProgress");
  assert.deepEqual(
    liveState.selectedThreadSnapshot.transcript.map((entry) => entry.text),
    ["The code path is stable and the runtime kernel is already in place."]
  );
});

test("refreshSelectedThreadSnapshot lets a lightweight refresh clear active turn state when completion is explicit", async () => {
  const { liveState, service } = createService({
    liveState: {
      lastError: null,
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: {
        thread: {
          id: "thr_dextunnel",
          name: "dextunnel",
          cwd: "/tmp/codex/dextunnel",
          activeTurnId: "turn_live",
          activeTurnStatus: "inProgress",
          lastTurnId: "turn_live",
          lastTurnStatus: "inProgress",
          status: "inProgress"
        },
        transcript: [
          {
            itemId: "item_agent_live",
            kind: "message",
            role: "assistant",
            text: "The code path is stable and the runtime kernel is already in place.",
            timestamp: "2026-03-24T16:25:00.100Z",
            turnId: "turn_live"
          }
        ],
        transcriptCount: 1
      },
      selectionSource: "remote",
      threads: [{ id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" }],
      turnDiff: null
    },
    readSelectedThread: async (threadId) => ({
      cwd: "/tmp/codex/dextunnel",
      id: threadId,
      name: "dextunnel",
      path: "/tmp/thread.jsonl"
    }),
    buildLightweightSelectedThreadSnapshot: async () => ({
      thread: {
        id: "thr_dextunnel",
        name: "dextunnel",
        cwd: "/tmp/codex/dextunnel",
        activeTurnId: null,
        activeTurnStatus: null,
        lastTurnId: "turn_live",
        lastTurnStatus: "completed",
        status: "completed"
      },
      transcript: [
        {
          kind: "message",
          role: "assistant",
          text: "Completed with evidence.",
          timestamp: "2026-03-24T16:25:02.000Z"
        }
      ],
      transcriptCount: 1
    }),
    snapshotNeedsDeepHydration: () => false
  });

  await service.refreshSelectedThreadSnapshot({ broadcastUpdate: false });

  assert.equal(liveState.selectedThreadSnapshot.thread.activeTurnId, null);
  assert.equal(liveState.selectedThreadSnapshot.thread.activeTurnStatus, null);
  assert.equal(liveState.selectedThreadSnapshot.thread.lastTurnStatus, "completed");
});

test("refreshSelectedThreadSnapshot clears snapshot and diff when nothing is selected", async () => {
  const { calls, liveState, service } = createService({
    liveState: {
      lastError: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: null,
      selectedThreadSnapshot: { thread: { id: "thr_old" } },
      selectionSource: "remote",
      threads: [],
      turnDiff: { threadId: "thr_old" }
    }
  });

  await service.refreshSelectedThreadSnapshot();

  assert.equal(liveState.selectedThreadSnapshot, null);
  assert.equal(liveState.turnDiff, null);
  assert.deepEqual(calls, [["broadcast", "live", { selectedThreadId: null }]]);
});

test("refreshLiveState composes thread and snapshot refreshes before broadcasting", async () => {
  const { calls, service } = createService({
    codexAppServer: {
      listThreads: async () => [{ id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" }],
      readThread: async () => ({
        cwd: "/tmp/codex/dextunnel",
        id: "thr_dextunnel",
        name: "dextunnel",
        transcript: []
      }),
      startThread: async () => ({ id: "thr_new" })
    },
    liveState: {
      lastError: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [],
      turnDiff: null
    }
  });

  const payload = await service.refreshLiveState();

  assert.deepEqual(payload, { selectedThreadId: "thr_dextunnel" });
  assert.deepEqual(calls, [
    ["loadAgentRoom", "thr_dextunnel"],
    ["broadcast", "live", { selectedThreadId: "thr_dextunnel" }]
  ]);
});

test("refreshLiveState can skip room-list hydration for lightweight refreshes", async () => {
  let listThreadsCalls = 0;
  const { calls, service } = createService({
    codexAppServer: {
      listThreads: async () => {
        listThreadsCalls += 1;
        return [{ id: "thr_dextunnel", name: "dextunnel", cwd: "/tmp/codex/dextunnel" }];
      },
      readThread: async () => ({
        cwd: "/tmp/codex/dextunnel",
        id: "thr_dextunnel",
        name: "dextunnel",
        transcript: []
      }),
      startThread: async () => ({ id: "thr_new" })
    },
    liveState: {
      lastError: null,
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null,
      selectionSource: "remote",
      threads: [{ id: "thr_existing", name: "existing", cwd: "/tmp/codex/dextunnel" }],
      turnDiff: null
    }
  });

  const payload = await service.refreshLiveState({ includeThreads: false });

  assert.deepEqual(payload, { selectedThreadId: "thr_dextunnel" });
  assert.equal(listThreadsCalls, 0);
  assert.deepEqual(calls, [
    ["loadAgentRoom", "thr_dextunnel"],
    ["broadcast", "live", { selectedThreadId: "thr_dextunnel" }]
  ]);
});

test("createThreadSelectionState starts a new persisted thread and updates live state", async () => {
  const { calls, liveState, service } = createService({
    codexAppServer: {
      listThreads: async () => [],
      readThread: async (threadId) => ({
        cwd: "/tmp/codex/new",
        id: threadId,
        name: "New thread",
        transcript: []
      }),
      startThread: async (params) => {
        calls.push(["startThread", params]);
        return { id: "thr_new" };
      }
    },
    liveState: {
      lastError: "old",
      lastSyncAt: null,
      selectedProjectCwd: "/tmp/codex/old",
      selectedThreadId: "thr_old",
      selectedThreadSnapshot: null,
      selectionSource: "host",
      threads: [{ id: "thr_old", name: "Old", cwd: "/tmp/codex/old" }],
      turnDiff: { threadId: "thr_old" }
    }
  });

  const result = await service.createThreadSelectionState({ cwd: "/tmp/codex/new", source: "remote" });

  assert.equal(result.snapshot.thread.id, "thr_new");
  assert.equal(liveState.selectedThreadId, "thr_new");
  assert.equal(liveState.selectionSource, "remote");
  assert.equal(liveState.turnDiff, null);
  assert.equal(liveState.lastError, null);
  assert.equal(liveState.lastSyncAt, "2026-03-20T16:30:00.000Z");
  assert.equal(liveState.threads[0].id, "thr_new");
  assert.deepEqual(calls[0], [
    "startThread",
    {
      approvalPolicy: "never",
      cwd: "/tmp/codex/new",
      ephemeral: false,
      persistExtendedHistory: true,
      sandbox: "workspace-write"
    }
  ]);
  assert.deepEqual(calls[1], ["clearControlLease", { broadcastUpdate: false }]);
});
