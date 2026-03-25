import test from "node:test";
import assert from "node:assert/strict";

import { createWatcherLifecycleService } from "../src/lib/watcher-lifecycle.mjs";

function createTimerHarness() {
  let nextId = 1;
  const timers = new Map();

  return {
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    runTimer(id) {
      const timer = timers.get(id);
      if (!timer) {
        return false;
      }
      timers.delete(id);
      timer.fn();
      return true;
    },
    scheduled() {
      return [...timers.entries()].map(([id, timer]) => ({ delay: timer.delay, id }));
    },
    setTimeoutFn(fn, delay) {
      const id = nextId++;
      timers.set(id, { delay, fn });
      return id;
    }
  };
}

function createService(overrides = {}) {
  const calls = [];
  const timers = createTimerHarness();
  const liveState = overrides.liveState || {
    lastError: null,
    pendingInteraction: null,
    selectedProjectCwd: "/tmp/codex/dextunnel",
    selectedThreadId: "thr_dextunnel",
    turnDiff: null,
    watcherConnected: false,
    writeLock: null
  };
  const appServerState = overrides.appServerState || {
    lastInteraction: null
  };
  const watchInvocations = [];
  const watchers = [];
  const codexAppServer = overrides.codexAppServer || {
    watchThread: async (params) => {
      watchInvocations.push(params);
      watchers.push(params);
      return {
        close() {
          calls.push(["watcher.close", params.threadId]);
        },
        respond() {},
        respondError() {}
      };
    }
  };

  const service = createWatcherLifecycleService({
    appServerState,
    applyWatcherNotification: (message, context) => {
      calls.push(["applyWatcherNotification", message.method, context.threadId]);
      return overrides.applyWatcherNotificationResult ?? false;
    },
    beginInteractionFlow: (request) => {
      calls.push(["beginInteractionFlow", request.requestId]);
      return { step: 1 };
    },
    broadcast: (event, payload) => calls.push(["broadcast", event, payload]),
    buildLivePayload: () => ({
      pendingInteraction: liveState.pendingInteraction?.requestId || null,
      watcherConnected: liveState.watcherConnected,
      writeLockStatus: liveState.writeLock?.status || null
    }),
    clearInteractionFlow: ({ threadId } = {}) => calls.push(["clearInteractionFlow", threadId || null]),
    codexAppServer,
    invalidateRepoChangesCache: ({ cwd } = {}) => calls.push(["invalidateRepoChangesCache", cwd || null]),
    liveState,
    mapPendingInteraction: (request) => ({
      kind: "command",
      requestId: request.requestId,
      summary: `pending:${request.requestId}`,
      threadId: request.params?.threadId || null,
      turnId: request.params?.turnId || null
    }),
    maybeWakeCompanionForCompaction: ({ threadId, turnId } = {}) =>
      calls.push(["wakeCompaction", threadId || null, turnId || null]),
    maybeWakeCompanionForInteractionResolution: ({ interaction, threadId } = {}) =>
      calls.push(["wakeInteraction", threadId || null, interaction?.status || null]),
    maybeWakeCompanionForTurnCompletion: ({ threadId, turnId } = {}) =>
      calls.push(["wakeTurnCompletion", threadId || null, turnId || null]),
    nowIso: () => "2026-03-20T21:15:00.000Z",
    refreshSelectedThreadSnapshot: async () => calls.push(["refreshSelectedThreadSnapshot"]),
    rememberTurnOrigin: (threadId, turnId, source) =>
      calls.push(["rememberTurnOrigin", threadId || null, turnId || null, source || null]),
    resetCompanionWakeups: (threadId, options) =>
      calls.push(["resetCompanionWakeups", threadId || null, options?.preserveLastWake || false]),
    summarizeNotificationInteraction: (pending, request) => ({
      requestId: request.requestId,
      status: "pending",
      summary: pending.summary,
      threadId: pending.threadId,
      turnId: pending.turnId
    }),
    watchRefreshMethods: new Set(["thread/title/updated"]),
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    ...overrides
  });

  return {
    appServerState,
    calls,
    liveState,
    service,
    timers,
    watchers,
    watchInvocations
  };
}

test("watcher lifecycle handles ready, close, and reconnect", async () => {
  const { calls, liveState, service, timers, watchInvocations, watchers } = createService();

  await service.restartWatcher();
  assert.equal(watchInvocations.length, 1);

  watchers[0].onReady();
  assert.equal(liveState.watcherConnected, true);
  assert.deepEqual(timers.scheduled(), [{ delay: 0, id: 1 }]);

  timers.runTimer(1);
  assert.ok(calls.some((entry) => entry[0] === "refreshSelectedThreadSnapshot"));

  liveState.pendingInteraction = { requestId: "pending-1" };
  watchers[0].onClose();
  assert.equal(liveState.watcherConnected, false);
  assert.equal(liveState.pendingInteraction, null);
  assert.ok(timers.scheduled().some((timer) => timer.delay === 1200));

  const reconnectTimer = timers.scheduled().find((timer) => timer.delay === 1200);
  timers.runTimer(reconnectTimer.id);
  assert.equal(watchInvocations.length, 2);
});

test("watcher lifecycle applies live turn notifications and refresh fallbacks", async () => {
  const { calls, liveState, service, timers, watchers } = createService();

  await service.restartWatcher();

  watchers[0].onNotification({
    method: "turn/started",
    params: {
      threadId: "thr_dextunnel",
      turn: { id: "turn-1" }
    }
  });
  assert.equal(liveState.writeLock.status, "running");
  assert.equal(liveState.turnDiff.turnId, "turn-1");
  assert.ok(calls.some((entry) => entry[0] === "rememberTurnOrigin"));

  watchers[0].onNotification({
    method: "turn/diff/updated",
    params: {
      diff: "diff --git a/file b/file",
      threadId: "thr_dextunnel",
      turnId: "turn-1"
    }
  });
  assert.equal(liveState.turnDiff.diff, "diff --git a/file b/file");

  watchers[0].onNotification({
    method: "thread/title/updated",
    params: { threadId: "thr_dextunnel" }
  });
  const refreshTimer = timers.scheduled().find((timer) => timer.delay === 180);
  assert.ok(refreshTimer);

  watchers[0].onNotification({
    method: "turn/completed",
    params: {
      threadId: "thr_dextunnel",
      turn: { id: "turn-1" }
    }
  });
  assert.equal(liveState.writeLock, null);
  assert.ok(calls.some((entry) => entry[0] === "wakeTurnCompletion"));
  assert.ok(timers.scheduled().some((timer) => timer.delay === 80));
  assert.ok(timers.scheduled().some((timer) => timer.delay === 1400));
});

test("watcher lifecycle maps server requests and resolves them cleanly", async () => {
  const { appServerState, calls, liveState, service, timers, watchers } = createService();

  await service.restartWatcher();

  watchers[0].onServerRequest({
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thr_dextunnel", turnId: "turn-9" },
    requestId: "request-9"
  });

  assert.equal(liveState.pendingInteraction.requestId, "request-9");
  assert.equal(appServerState.lastInteraction.status, "pending");

  watchers[0].onNotification({
    method: "serverRequest/resolved",
    params: {
      requestId: "request-9",
      threadId: "thr_dextunnel"
    }
  });

  assert.equal(liveState.pendingInteraction, null);
  assert.equal(appServerState.lastInteraction.status, "resolved");
  assert.ok(calls.some((entry) => entry[0] === "wakeInteraction"));

  const refreshTimer = timers.scheduled().find((timer) => timer.delay === 60);
  assert.ok(refreshTimer);
});

test("watcher lifecycle ignores stale watcher callbacks after restart", async () => {
  const { calls, liveState, service, watchers } = createService();

  await service.restartWatcher();
  const staleWatcher = watchers[0];

  await service.restartWatcher();
  staleWatcher.onReady();
  staleWatcher.onNotification({
    method: "turn/started",
    params: {
      threadId: "thr_dextunnel",
      turn: { id: "turn-stale" }
    }
  });

  assert.equal(liveState.writeLock, null);
  assert.equal(liveState.watcherConnected, false);
  assert.equal(calls.filter((entry) => entry[0] === "applyWatcherNotification").length, 0);
});
