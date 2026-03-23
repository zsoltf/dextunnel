import test from "node:test";
import assert from "node:assert/strict";

import {
  clearControlLease as clearControlLeaseState,
  ensureRemoteControlLease as ensureRemoteControlLeaseState,
  getControlLeaseForThread as getControlLeaseForThreadState,
  renewControlLease as renewControlLeaseState,
  setControlLease as setControlLeaseState
} from "../src/lib/shared-room-state.mjs";
import { createControlLeaseService } from "../src/lib/control-lease-service.mjs";

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
  const state = {
    controlLease: null,
    selectedThreadId: "thr_dextunnel",
    ...overrides.liveState
  };
  let now = overrides.now ?? new Date("2026-03-20T20:00:00.000Z").getTime();

  const service = createControlLeaseService({
    broadcast: (event, payload) => calls.push(["broadcast", event, payload]),
    buildLivePayload: () => ({ controlLease: state.controlLease }),
    clearControlLeaseState,
    ensureRemoteControlLeaseState,
    getControlLeaseForThreadState,
    liveState: state,
    nowMs: () => now,
    recordControlEvent: (payload) => calls.push(["recordControlEvent", payload]),
    renewControlLeaseState,
    setControlLeaseState,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn
  });

  return {
    calls,
    liveState: state,
    service,
    setNow(next) {
      now = next;
    },
    timers
  };
}

test("control lease service sets and renews a lease for the selected thread", () => {
  const { liveState, service, timers } = createService();

  const lease = service.setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thr_dextunnel",
    ttlMs: 5000
  });

  assert.equal(lease.threadId, "thr_dextunnel");
  assert.equal(service.getControlLeaseForSelectedThread().ownerClientId, "remote-a");
  assert.deepEqual(timers.scheduled(), [{ delay: 5000, id: 1 }]);

  const renewed = service.renewControlLease({
    clientId: "remote-a",
    threadId: "thr_dextunnel",
    ttlMs: 8000
  });

  assert.equal(renewed.ownerClientId, "remote-a");
  assert.deepEqual(timers.scheduled(), [{ delay: 8000, id: 2 }]);
  assert.equal(liveState.controlLease.threadId, "thr_dextunnel");
});

test("control lease service expires and broadcasts the release", () => {
  const { calls, liveState, service, timers } = createService();

  service.setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thr_dextunnel",
    ttlMs: 1000
  });

  const timer = timers.scheduled()[0];
  timers.runTimer(timer.id);

  assert.equal(liveState.controlLease, null);
  assert.ok(calls.some((entry) => entry[0] === "recordControlEvent" && entry[1].cause === "expired"));
  assert.ok(calls.some((entry) => entry[0] === "broadcast"));
});

test("control lease service enforces remote ownership when renewing for send", () => {
  const { liveState, service } = createService();

  service.setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thr_dextunnel",
    ttlMs: 5000
  });

  service.ensureRemoteControlLease("thr_dextunnel", "remote", "remote-a", 5000);
  assert.equal(liveState.controlLease.ownerClientId, "remote-a");

  assert.throws(
    () => service.ensureRemoteControlLease("thr_dextunnel", "remote", "remote-b", 5000),
    /Another remote surface/
  );
});

test("control lease service ignores clear requests for other threads and clears expired reads lazily", () => {
  const now = new Date("2026-03-20T20:00:00.000Z").getTime();
  const { liveState, service, setNow } = createService({ now });

  service.setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thr_dextunnel",
    ttlMs: 1000
  });

  service.clearControlLease({ threadId: "thr_other" });
  assert.equal(liveState.controlLease.threadId, "thr_dextunnel");

  setNow(now + 1500);
  assert.equal(service.getControlLeaseForThread("thr_dextunnel"), null);
  assert.equal(liveState.controlLease, null);
});
