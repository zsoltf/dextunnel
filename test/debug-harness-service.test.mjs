import test from "node:test";
import assert from "node:assert/strict";

import { createDebugHarnessService } from "../src/lib/debug-harness-service.mjs";

function createService(overrides = {}) {
  const calls = [];
  const liveState = overrides.liveState || {
    lastError: "old-error",
    pendingInteraction: null,
    selectedProjectCwd: "/tmp/codex/dextunnel",
    selectedThreadId: "thr_dextunnel",
    selectedThreadSnapshot: {
      thread: {
        cwd: "/tmp/codex/dextunnel",
        id: "thr_dextunnel"
      }
    }
  };
  const appServerState = overrides.appServerState || {
    lastInteraction: null
  };

  const service = createDebugHarnessService({
    ADVISORY_PARTICIPANT_IDS: ["oracle", "gemini"],
    appServerState,
    broadcast: (event, payload) => calls.push(["broadcast", event, payload]),
    buildLivePayload: () => ({
      pendingInteraction: liveState.pendingInteraction,
      selectedThreadId: liveState.selectedThreadId
    }),
    getDefaultCwd: () => "/tmp/default",
    liveState,
    nowIso: () => "2026-03-20T22:00:00.000Z",
    nowMs: () => 111,
    queueCompanionWakeup: (payload) => calls.push(["queueCompanionWakeup", payload]),
    ...overrides
  });

  return {
    appServerState,
    calls,
    liveState,
    service
  };
}

test("debug harness service seeds and clears pending interactions", () => {
  const { appServerState, calls, liveState, service } = createService();

  const created = service.setDebugPendingInteraction("user_input");
  assert.equal(created.pendingInteraction.actionKind, "user_input");
  assert.equal(liveState.pendingInteraction?.threadId, "thr_dextunnel");
  assert.equal(liveState.lastError, null);
  assert.equal(appServerState.lastInteraction?.status, "pending");
  assert.ok(calls.some((entry) => entry[0] === "broadcast"));

  const cleared = service.clearDebugPendingInteraction();
  assert.equal(cleared.pendingInteraction, null);
  assert.equal(liveState.pendingInteraction, null);
  assert.equal(appServerState.lastInteraction?.status, "cleared");
});

test("debug harness service rejects overlap and invalid advisors", () => {
  const busy = createService({
    liveState: {
      lastError: null,
      pendingInteraction: { requestId: "req-1" },
      selectedProjectCwd: "/tmp/codex/dextunnel",
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: null
    }
  });
  assert.throws(
    () => busy.service.setDebugPendingInteraction("command"),
    /Resolve the pending interaction/
  );

  const { service } = createService();
  assert.throws(
    () => service.setDebugCompanionWakeup({ advisorId: "spark", wakeKind: "review" }),
    /Unsupported advisory participant/
  );
});

test("debug harness service seeds companion wakeups with review and summary defaults", () => {
  const { calls, service } = createService();

  service.setDebugCompanionWakeup({ wakeKind: "review" });
  service.setDebugCompanionWakeup({ advisorId: "gemini", wakeKind: "summary" });

  assert.deepEqual(
    calls.filter((entry) => entry[0] === "queueCompanionWakeup").map((entry) => entry[1]),
    [
      {
        advisorId: "oracle",
        text: "Review ready: local-only wakeup harness seeded a review notice for this channel.",
        threadId: "thr_dextunnel",
        turnId: null,
        wakeKey: "debug-oracle-review:111",
        wakeKind: "review"
      },
      {
        advisorId: "gemini",
        text: "Summary ready: local-only wakeup harness seeded a summary notice for this channel.",
        threadId: "thr_dextunnel",
        turnId: null,
        wakeKey: "debug-gemini-summary:111",
        wakeKind: "summary"
      }
    ]
  );
});
