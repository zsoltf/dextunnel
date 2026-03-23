import test from "node:test";
import assert from "node:assert/strict";

import {
  nextBackoffDelay,
  planBootstrapRetry,
  planStreamRecovery,
  reconnectStreamState,
  shouldScheduleRetry
} from "../public/live-bridge-retry-state.js";

test("nextBackoffDelay uses the current delay and caps the next value", () => {
  assert.deepEqual(nextBackoffDelay(700, { baseMs: 700, maxMs: 5000 }), {
    delay: 700,
    nextMs: 1400
  });

  assert.deepEqual(nextBackoffDelay(4000, { baseMs: 700, maxMs: 5000 }), {
    delay: 4000,
    nextMs: 5000
  });
});

test("shouldScheduleRetry requires a visible surface and no existing timer", () => {
  assert.equal(shouldScheduleRetry({ hasTimer: false, isVisible: true }), true);
  assert.equal(shouldScheduleRetry({ hasTimer: true, isVisible: true }), false);
  assert.equal(shouldScheduleRetry({ hasTimer: false, isVisible: false }), false);
});

test("planBootstrapRetry schedules a retry with exponential backoff", () => {
  assert.deepEqual(
    planBootstrapRetry({
      backoffMs: 900,
      baseMs: 900,
      maxMs: 6000,
      hasTimer: false,
      isVisible: true
    }),
    {
      delay: 900,
      nextBackoffMs: 1800,
      schedule: true
    }
  );
});

test("planStreamRecovery distinguishes refresh from bootstrap follow-up", () => {
  assert.deepEqual(
    planStreamRecovery({
      backoffMs: 700,
      baseMs: 700,
      maxMs: 5000,
      hasLiveState: false,
      hasTimer: false,
      isVisible: true
    }),
    {
      delay: 700,
      followupAction: "bootstrap",
      nextBackoffMs: 1400,
      schedule: true,
      streamState: "connecting"
    }
  );

  assert.deepEqual(
    planStreamRecovery({
      backoffMs: 700,
      baseMs: 700,
      maxMs: 5000,
      hasLiveState: true,
      hasTimer: false,
      isVisible: true
    }),
    {
      delay: 700,
      followupAction: "refresh",
      nextBackoffMs: 1400,
      schedule: true,
      streamState: "recovering"
    }
  );
});

test("reconnectStreamState reflects whether live state already exists", () => {
  assert.equal(reconnectStreamState({ hasLiveState: false }), "connecting");
  assert.equal(reconnectStreamState({ hasLiveState: true }), "recovering");
});
