import test from "node:test";
import assert from "node:assert/strict";

import {
  createLiveBridgeLifecycle,
  createLiveBridgeLifecycleState
} from "../public/live-bridge-lifecycle.js";

class FakeEventSource {
  constructor() {
    this.closed = false;
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  close() {
    this.closed = true;
  }

  emit(type, payload = null) {
    const handlers = this.listeners.get(type) || [];
    for (const handler of handlers) {
      handler({
        data: payload == null ? null : JSON.stringify(payload)
      });
    }
  }
}

function createTimerHarness() {
  let nextId = 1;
  const pending = new Map();

  return {
    clearTimeout(id) {
      pending.delete(id);
    },
    pendingCount() {
      return pending.size;
    },
    runNext() {
      const next = pending.entries().next().value;
      if (!next) {
        return false;
      }
      const [id, callback] = next;
      pending.delete(id);
      callback();
      return true;
    },
    setTimeout(callback, _delay) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    }
  };
}

function createHarness({
  hasLiveState = false,
  requestBootstrap = async () => ({ live: { ok: true }, snapshot: { ok: true } }),
  requestRefresh = async () => ({ state: { ok: true } }),
  visible = true
} = {}) {
  const timers = createTimerHarness();
  const eventSources = [];
  const calls = {
    bootstrapStart: 0,
    bootstrapSuccess: 0,
    ensureOpen: 0,
    live: 0,
    render: 0,
    requestBootstrap: 0,
    requestRefresh: 0,
    snapshot: 0,
    streamError: 0
  };

  let liveState = hasLiveState;

  const state = createLiveBridgeLifecycleState({
    bootstrapRetryBaseMs: 100,
    streamRecoveryBaseMs: 75
  });

  const lifecycle = createLiveBridgeLifecycle({
    bootstrapRetry: { baseMs: 100, maxMs: 800 },
    createEventSource() {
      const source = new FakeEventSource();
      eventSources.push(source);
      return source;
    },
    createTimeout: timers.setTimeout,
    clearCreatedTimeout: timers.clearTimeout,
    getHasLiveState() {
      return liveState;
    },
    getVisible() {
      return visible;
    },
    onBootstrapError() {},
    onBootstrapStart() {
      calls.bootstrapStart += 1;
    },
    onBootstrapSuccess() {
      calls.bootstrapSuccess += 1;
      liveState = true;
    },
    onLive() {
      calls.live += 1;
      liveState = true;
    },
    onRender() {
      calls.render += 1;
    },
    onSnapshot() {
      calls.snapshot += 1;
    },
    onStreamError() {
      calls.streamError += 1;
    },
    onStreamOpen() {
      calls.ensureOpen += 1;
    },
    requestBootstrap() {
      calls.requestBootstrap += 1;
      return requestBootstrap();
    },
    requestRefresh({ background: _background }) {
      calls.requestRefresh += 1;
      return requestRefresh();
    },
    state,
    streamRecovery: { baseMs: 75, maxMs: 600 },
    streamUrl: "/api/stream"
  });

  return {
    calls,
    eventSources,
    lifecycle,
    setLiveState(value) {
      liveState = value;
    },
    setVisible(value) {
      visible = value;
    },
    state,
    timers
  };
}

test("resumeVisible ensures stream and bootstraps when no live state exists", async () => {
  const harness = createHarness({ hasLiveState: false });

  harness.lifecycle.resumeVisible();
  assert.equal(harness.eventSources.length, 1);
  assert.equal(harness.calls.requestBootstrap, 1);

  await harness.state.bootstrapPromise;

  assert.equal(harness.calls.bootstrapStart, 1);
  assert.equal(harness.calls.bootstrapSuccess, 1);
});

test("stream recovery waits for open before background refresh", async () => {
  const harness = createHarness({ hasLiveState: true });

  harness.lifecycle.ensureStream();
  assert.equal(harness.eventSources.length, 1);

  const firstSource = harness.eventSources[0];
  firstSource.emit("error");
  assert.equal(harness.calls.streamError, 1);
  assert.equal(harness.calls.requestRefresh, 0);
  assert.equal(harness.timers.pendingCount(), 1);

  harness.timers.runNext();
  assert.equal(harness.eventSources.length, 2);
  assert.equal(harness.calls.requestRefresh, 0);

  const secondSource = harness.eventSources[1];
  secondSource.emit("open");
  await Promise.resolve();

  assert.equal(harness.calls.ensureOpen, 1);
  assert.equal(harness.calls.requestRefresh, 1);
});

test("bootstrap failure schedules retry and retries when visible", async () => {
  let attempts = 0;
  const harness = createHarness({
    hasLiveState: false,
    requestBootstrap: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("bridge down");
      }

      return {
        live: { ok: true },
        snapshot: { ok: true }
      };
    }
  });

  await harness.lifecycle.bootstrap();
  assert.equal(harness.calls.requestBootstrap, 1);
  assert.equal(harness.timers.pendingCount(), 1);

  harness.timers.runNext();
  await harness.state.bootstrapPromise;

  assert.equal(harness.calls.requestBootstrap, 2);
  assert.equal(harness.calls.bootstrapSuccess, 1);
});
