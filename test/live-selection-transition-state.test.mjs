import test from "node:test";
import assert from "node:assert/strict";

import { applyLiveControlAction } from "../src/lib/live-control-state.mjs";
import { applyLiveSelectionTransition } from "../src/lib/live-selection-transition-state.mjs";

const TTL_MS = 5 * 60 * 1000;

test("switching threads clears the active lease and interaction flow", () => {
  const claimed = applyLiveControlAction({
    action: "claim",
    clientId: "remote-a",
    source: "remote",
    threadId: "thread-a",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 30, 0)
  });

  const result = applyLiveSelectionTransition(
    {
      controlLease: claimed.lease,
      interactionFlow: {
        requestId: "req-1",
        threadId: "thread-a",
        turnId: "turn-1"
      },
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-a",
      selectedThreadSnapshot: { thread: { id: "thread-a" } },
      selectionSource: "remote",
      turnDiff: { diff: "stale", threadId: "thread-a" },
      writeLock: { status: "running", threadId: "thread-a" }
    },
    {
      source: "remote",
      threadId: "thread-b"
    },
    {
      now: Date.UTC(2026, 2, 18, 23, 30, 15)
    }
  );

  assert.equal(result.threadChanged, true);
  assert.deepEqual(result.cleared, {
    controlLease: true,
    interactionFlow: true
  });
  assert.equal(result.nextState.selectedThreadId, "thread-b");
  assert.equal(result.nextState.selectedThreadSnapshot, null);
  assert.equal(result.nextState.turnDiff, null);
  assert.equal(result.nextState.writeLock, null);
  assert.equal(result.nextState.controlLease, null);
  assert.equal(result.nextState.interactionFlow, null);
});

test("same-thread reselection preserves the active lease and interaction flow", () => {
  const claimed = applyLiveControlAction({
    action: "claim",
    clientId: "remote-a",
    source: "remote",
    threadId: "thread-a",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 31, 0)
  });

  const interactionFlow = {
    requestId: "req-2",
    threadId: "thread-a",
    turnId: "turn-2"
  };

  const result = applyLiveSelectionTransition(
    {
      controlLease: claimed.lease,
      interactionFlow,
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-a",
      selectedThreadSnapshot: { thread: { id: "thread-a" } },
      selectionSource: "remote",
      turnDiff: { diff: "kept", threadId: "thread-a" },
      writeLock: { status: "running", threadId: "thread-a" }
    },
    {
      source: "host",
      threadId: "thread-a"
    },
    {
      now: Date.UTC(2026, 2, 18, 23, 31, 12)
    }
  );

  assert.equal(result.threadChanged, false);
  assert.deepEqual(result.cleared, {
    controlLease: false,
    interactionFlow: false
  });
  assert.equal(result.nextState.controlLease?.ownerClientId, "remote-a");
  assert.deepEqual(result.nextState.interactionFlow, interactionFlow);
  assert.equal(result.nextState.selectionSource, "host");
});

test("switching threads after a lease clear allows a new remote to claim the new room", () => {
  const claimed = applyLiveControlAction({
    action: "claim",
    clientId: "remote-a",
    source: "remote",
    threadId: "thread-a",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 32, 0)
  });

  const transitioned = applyLiveSelectionTransition(
    {
      controlLease: claimed.lease,
      interactionFlow: null,
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-a",
      selectedThreadSnapshot: { thread: { id: "thread-a" } },
      selectionSource: "remote",
      turnDiff: null,
      writeLock: null
    },
    {
      cwd: "/repo-b",
      source: "remote",
      threads: [
        { cwd: "/repo-a", id: "thread-a" },
        { cwd: "/repo-b", id: "thread-b" }
      ]
    },
    {
      now: Date.UTC(2026, 2, 18, 23, 32, 10)
    }
  );

  const reclaimed = applyLiveControlAction({
    action: "claim",
    clientId: "remote-b",
    existingLease: transitioned.nextState.controlLease,
    source: "remote",
    threadId: transitioned.nextState.selectedThreadId,
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 32, 20)
  });

  assert.equal(transitioned.nextState.selectedThreadId, "thread-b");
  assert.equal(reclaimed.lease.ownerClientId, "remote-b");
  assert.equal(reclaimed.lease.threadId, "thread-b");
});
