import test from "node:test";
import assert from "node:assert/strict";

import { createSelectionStateService } from "../src/lib/selection-state-service.mjs";
import { applyLiveSelectionTransition } from "../src/lib/live-selection-transition-state.mjs";

function createService(overrides = {}) {
  const calls = [];
  const liveState = overrides.liveState || {
    controlLease: {
      expiresAt: "2026-03-20T20:35:00.000Z",
      owner: "remote",
      ownerClientId: "remote-a",
      ownerLabel: "remote-a",
      reason: "compose",
      source: "remote",
      threadId: "thr_old"
    },
    interactionFlow: { requestId: "req-1", threadId: "thr_old", turnId: "turn-1" },
    selectedProjectCwd: "/tmp/codex/old",
    selectedThreadId: "thr_old",
    selectedThreadSnapshot: { thread: { cwd: "/tmp/codex/old", id: "thr_old", name: "Old" } },
    selectionSource: "remote",
    threads: [
      { cwd: "/tmp/codex/old", id: "thr_old", name: "Old" },
      { cwd: "/tmp/codex/new", id: "thr_new", name: "New" }
    ],
    turnDiff: { diff: "stale", threadId: "thr_old" },
    writeLock: { status: "running", threadId: "thr_old" }
  };
  const appServerState = overrides.appServerState || {
    lastSelectionEvent: null
  };

  const service = createSelectionStateService({
    appServerState,
    applyLiveSelectionTransition,
    bestThreadLabel: (thread) => thread.name || `session-${thread.id}`,
    broadcast: (event, payload) => calls.push(["broadcast", event, payload]),
    buildLivePayload: () => ({ selectedThreadId: liveState.selectedThreadId }),
    createThreadSelectionState: async ({ cwd, source }) => {
      calls.push(["createThreadSelectionState", cwd || null, source || null]);
      liveState.selectedProjectCwd = cwd || "/tmp/codex/new";
      liveState.selectedThreadId = "thr_new";
      liveState.selectedThreadSnapshot = {
        thread: { cwd: cwd || "/tmp/codex/new", id: "thr_new", name: "New session" }
      };
      liveState.selectionSource = source;
      liveState.controlLease = null;
      liveState.turnDiff = null;
      return {
        snapshot: liveState.selectedThreadSnapshot,
        thread: liveState.selectedThreadSnapshot.thread
      };
    },
    getPendingInteractionForSelectedThread: () => overrides.pendingInteraction || null,
    liveState,
    nowIso: () => "2026-03-20T20:30:00.000Z",
    nowMs: () => Date.UTC(2026, 2, 20, 20, 30, 0),
    projectLabel: (cwd) => cwd.split("/").slice(-1)[0] || "",
    randomId: () => "selection-1",
    refreshSelectedThreadSnapshot: async ({ broadcastUpdate = true } = {}) =>
      calls.push(["refreshSelectedThreadSnapshot", broadcastUpdate]),
    refreshThreads: async ({ broadcastUpdate = true } = {}) =>
      calls.push(["refreshThreads", broadcastUpdate]),
    restartWatcher: async () => calls.push(["restartWatcher"]),
    scheduleControlLeaseExpiry: () => calls.push(["scheduleControlLeaseExpiry"]),
    shortThreadId: (value) => String(value || "").slice(0, 6),
    slugifyChannelName: (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "-"),
    surfaceActorLabel: ({ surface = "", clientId = null } = {}) => (clientId ? `${surface}:${clientId}` : surface),
    ...overrides
  });

  return {
    appServerState,
    calls,
    liveState,
    service
  };
}

test("selection service switches threads, refreshes state, and records an event", async () => {
  const { appServerState, calls, liveState, service } = createService();

  const result = await service.setSelection({
    clientId: "remote-a",
    source: "remote",
    threadId: "thr_new"
  });

  assert.equal(result.state.selectedThreadId, "thr_new");
  assert.equal(liveState.selectedThreadId, "thr_new");
  assert.equal(liveState.controlLease, null);
  assert.equal(liveState.interactionFlow, null);
  assert.equal(liveState.turnDiff, null);
  assert.equal(liveState.writeLock, null);
  assert.equal(appServerState.lastSelectionEvent?.id, "selection-1");
  assert.equal(appServerState.lastSelectionEvent?.toThreadId, "thr_new");
  assert.ok(calls.some((entry) => entry[0] === "scheduleControlLeaseExpiry"));
  assert.deepEqual(calls.slice(0, 2), [
    ["scheduleControlLeaseExpiry"],
    ["refreshSelectedThreadSnapshot", false]
  ]);
  assert.ok(calls.some((entry) => entry[0] === "broadcast"));
  assert.ok(calls.some((entry) => entry[0] === "restartWatcher"));
  assert.ok(calls.some((entry) => entry[0] === "refreshThreads" && entry[1] === true));
});

test("selection service creates a new thread and rejects busy or blocked cases", async () => {
  const blocked = createService({ pendingInteraction: { requestId: "req-2" } });
  await assert.rejects(
    () => blocked.service.createThreadSelection({ cwd: "/tmp/codex/new", source: "remote" }),
    /Resolve the pending interaction/
  );

  const busy = createService({
    liveState: {
      controlLease: null,
      interactionFlow: null,
      selectedProjectCwd: "/tmp/codex/old",
      selectedThreadId: "thr_old",
      selectedThreadSnapshot: { thread: { cwd: "/tmp/codex/old", id: "thr_old", name: "Old" } },
      selectionSource: "remote",
      threads: [{ cwd: "/tmp/codex/old", id: "thr_old", name: "Old" }],
      turnDiff: null,
      writeLock: { status: "running", threadId: "thr_old" }
    }
  });
  await assert.rejects(
    () => busy.service.createThreadSelection({ cwd: "/tmp/codex/new", source: "remote" }),
    /Wait for the current live write/
  );

  const { appServerState, calls, liveState, service } = createService({
    liveState: {
      controlLease: null,
      interactionFlow: null,
      selectedProjectCwd: "/tmp/codex/old",
      selectedThreadId: "thr_old",
      selectedThreadSnapshot: { thread: { cwd: "/tmp/codex/old", id: "thr_old", name: "Old" } },
      selectionSource: "remote",
      threads: [{ cwd: "/tmp/codex/old", id: "thr_old", name: "Old" }],
      turnDiff: null,
      writeLock: null
    }
  });

  const result = await service.createThreadSelection({
    clientId: "remote-a",
    cwd: "/tmp/codex/new",
    source: "remote"
  });

  assert.equal(result.thread.id, "thr_new");
  assert.equal(liveState.selectedThreadId, "thr_new");
  assert.equal(appServerState.lastSelectionEvent?.cause, "created");
  assert.ok(calls.some((entry) => entry[0] === "restartWatcher"));
  assert.ok(calls.some((entry) => entry[0] === "refreshThreads" && entry[1] === true));
});
