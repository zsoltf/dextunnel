import test from "node:test";
import assert from "node:assert/strict";

import { createBridgeRuntimeLifecycleService } from "../src/lib/bridge-runtime-lifecycle.mjs";

function createService(overrides = {}) {
  const calls = [];
  const liveState = overrides.liveState || {
    lastError: "old-error",
    selectedThreadSnapshot: {
      thread: {
        activeTurnId: "turn-1",
        id: "thr_dextunnel"
      }
    },
    writeLock: {
      status: "running",
      threadId: "thr_dextunnel"
    }
  };

  const service = createBridgeRuntimeLifecycleService({
    broadcast: (event, payload) => calls.push(["broadcast", event, payload]),
    buildLivePayload: () => ({
      selectedThreadId: liveState.selectedThreadSnapshot?.thread?.id || null,
      writeLock: liveState.writeLock
    }),
    cleanupAttachmentDir: async () => calls.push(["cleanupAttachmentDir"]),
    codexAppServer: {
      interruptTurn: async ({ threadId, turnId }) => {
        calls.push(["interruptTurn", threadId, turnId]);
      }
    },
    liveState,
    refreshSelectedThreadSnapshot: async ({ broadcastUpdate = true } = {}) =>
      calls.push(["refreshSelectedThreadSnapshot", broadcastUpdate]),
    refreshThreads: async ({ broadcastUpdate = true } = {}) =>
      calls.push(["refreshThreads", broadcastUpdate]),
    restartWatcher: async () => calls.push(["restartWatcher"]),
    scheduleSnapshotRefresh: (delay) => calls.push(["scheduleSnapshotRefresh", delay]),
    ...overrides
  });

  return {
    calls,
    liveState,
    service
  };
}

test("bridge runtime lifecycle interrupts the selected live turn and refreshes state", async () => {
  const { calls, liveState, service } = createService();

  const result = await service.interruptSelectedThread();

  assert.equal(result.ok, true);
  assert.equal(liveState.writeLock, null);
  assert.equal(liveState.lastError, null);
  assert.deepEqual(calls.slice(0, 2), [
    ["interruptTurn", "thr_dextunnel", "turn-1"],
    ["scheduleSnapshotRefresh", 100]
  ]);
  assert.ok(calls.some((entry) => entry[0] === "broadcast"));
});

test("bridge runtime lifecycle rejects missing or idle selected threads", async () => {
  const missing = createService({
    liveState: {
      lastError: null,
      selectedThreadSnapshot: null,
      writeLock: null
    }
  });
  await assert.rejects(
    () => missing.service.interruptSelectedThread(),
    /No live Codex thread is selected/
  );

  const idle = createService({
    liveState: {
      lastError: null,
      selectedThreadSnapshot: {
        thread: {
          activeTurnId: null,
          id: "thr_dextunnel"
        }
      },
      writeLock: null
    }
  });
  await assert.rejects(
    () => idle.service.interruptSelectedThread(),
    /not currently running/
  );
});

test("bridge runtime lifecycle bootstraps attachment cleanup, thread refresh, and watcher restart", async () => {
  const { calls, service } = createService();

  await service.bootstrapLiveState();

  assert.deepEqual(calls, [
    ["cleanupAttachmentDir"],
    ["refreshThreads", false],
    ["refreshSelectedThreadSnapshot", false],
    ["restartWatcher"]
  ]);
});
