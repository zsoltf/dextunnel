import test from "node:test";
import assert from "node:assert/strict";

import { createInteractionResolutionService } from "../src/lib/interaction-resolution-service.mjs";

function createService(overrides = {}) {
  const calls = [];
  const watcher = overrides.watcher || {
    respond: (requestId, payload) => calls.push(["respond", requestId, payload]),
    respondError: (requestId, error) => calls.push(["respondError", requestId, error])
  };
  const liveState = overrides.liveState || {
    lastError: "old-error",
    pendingInteraction: null
  };
  const appServerState = overrides.appServerState || {
    lastInteraction: null
  };
  const service = createInteractionResolutionService({
    appServerState,
    broadcast: (event, payload) => calls.push(["broadcast", event, payload]),
    buildLivePayload: () => ({ pendingInteraction: liveState.pendingInteraction }),
    controlLeaseTtlMs: 300000,
    ensureRemoteControlLease: (...args) => calls.push(["ensureRemoteControlLease", ...args]),
    getWatcherController: () => watcher,
    hasWatcherController: () => overrides.watcherConnected ?? true,
    liveState,
    maybeWakeCompanionForInteractionResolution: (payload) =>
      calls.push(["maybeWakeCompanionForInteractionResolution", payload]),
    nowIso: () => "2026-03-20T23:30:00.000Z",
    setControlLease: (payload) => calls.push(["setControlLease", payload]),
    ...overrides
  });

  return {
    appServerState,
    calls,
    liveState,
    service
  };
}

test("interaction resolution service resolves debug input locally and wakes companion", async () => {
  const { appServerState, calls, liveState, service } = createService({
    liveState: {
      lastError: "old-error",
      pendingInteraction: {
        actionKind: "user_input",
        debug: true,
        kind: "tool_input",
        kindLabel: "Tool input",
        questions: [{ id: "deploy_note" }],
        requestId: "req-1",
        summary: "deploy note",
        threadId: "thr_dextunnel"
      }
    }
  });

  await service.resolvePendingInteraction({
    action: "submit",
    answers: { deploy_note: "Ship it" },
    source: "remote"
  });

  assert.equal(liveState.pendingInteraction, null);
  assert.equal(liveState.lastError, null);
  assert.equal(appServerState.lastInteraction?.status, "resolved");
  assert.deepEqual(appServerState.lastInteraction?.answers, {
    deploy_note: { answers: ["Ship it"] }
  });
  assert.ok(calls.some((entry) => entry[0] === "maybeWakeCompanionForInteractionResolution"));
});

test("interaction resolution service routes watcher approvals and renews control", async () => {
  const { appServerState, calls, liveState, service } = createService({
    liveState: {
      lastError: "old-error",
      pendingInteraction: {
        actionKind: "approval",
        availableDecisions: ["accept", "acceptForSession", "decline"],
        itemId: "item-1",
        kind: "command",
        kindLabel: "Command",
        method: "item/commandExecution/requestApproval",
        requestId: "req-1",
        summary: "npm test",
        threadId: "thr_dextunnel",
        turnId: "turn-1"
      }
    }
  });

  await service.resolvePendingInteraction({
    action: "session",
    authorityClientId: "remote-a",
    source: "remote"
  });

  assert.equal(liveState.pendingInteraction, null);
  assert.equal(appServerState.lastInteraction?.status, "responded");
  assert.ok(calls.some((entry) => entry[0] === "ensureRemoteControlLease"));
  assert.ok(
    calls.some(
      (entry) =>
        entry[0] === "respond" &&
        entry[1] === "req-1" &&
        entry[2].decision === "acceptForSession"
    )
  );
  assert.ok(
    calls.some(
      (entry) =>
        entry[0] === "setControlLease" &&
        entry[1]?.clientId === "remote-a" &&
        entry[1]?.threadId === "thr_dextunnel"
    )
  );
});

test("interaction resolution service rejects missing watcher for live requests", async () => {
  const { service } = createService({
    watcherConnected: false,
    liveState: {
      lastError: null,
      pendingInteraction: {
        actionKind: "approval",
        debug: false,
        kind: "command",
        method: "item/commandExecution/requestApproval",
        requestId: "req-1",
        threadId: "thr_dextunnel"
      }
    }
  });

  await assert.rejects(
    () => service.resolvePendingInteraction({ action: "approve", source: "host" }),
    /Live watcher is not connected/
  );
});
