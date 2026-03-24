import test from "node:test";
import assert from "node:assert/strict";

import { applyLiveControlAction } from "../src/lib/live-control-state.mjs";
import { setControlLease } from "../src/lib/shared-room-state.mjs";

const TTL_MS = 5 * 60 * 1000;

test("claim creates a lease and claim event for the selected thread", () => {
  const result = applyLiveControlAction({
    action: "claim",
    clientId: "remote-a",
    source: "remote",
    threadId: "thread-1",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 0, 0)
  });

  assert.equal(result.lease.threadId, "thread-1");
  assert.equal(result.lease.ownerClientId, "remote-a");
  assert.equal(result.event?.action, "claim");
  assert.equal(result.event?.ownerClientId, "remote-a");
  assert.equal(result.recordEvent, true);
});

test("renew preserves lease ownership and does not emit a control event", () => {
  const existingLease = setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thread-1",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 1, 0)
  });

  const result = applyLiveControlAction({
    action: "renew",
    clientId: "remote-a",
    existingLease,
    source: "remote",
    threadId: "thread-1",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 1, 30)
  });

  assert.equal(result.lease.ownerClientId, "remote-a");
  assert.equal(result.event, null);
  assert.equal(result.recordEvent, false);
});

test("release clears the matching lease and emits a release event", () => {
  const existingLease = setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thread-1",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 2, 0)
  });

  const result = applyLiveControlAction({
    action: "release",
    clientId: "remote-a",
    existingLease,
    source: "remote",
    threadId: "thread-1",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 2, 30)
  });

  assert.equal(result.lease, null);
  assert.equal(result.event?.action, "release");
  assert.equal(result.event?.threadId, "thread-1");
  assert.equal(result.recordEvent, true);
});

test("second remote cannot claim over an existing remote lease", () => {
  const existingLease = setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thread-1",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 3, 0)
  });

  assert.throws(
    () =>
      applyLiveControlAction({
        action: "claim",
        clientId: "remote-b",
        existingLease,
        source: "remote",
        threadId: "thread-1",
        ttlMs: TTL_MS,
        now: Date.UTC(2026, 2, 18, 23, 3, 10)
      }),
    /Another remote surface currently holds control/
  );
});

test("release is a no-op when there is no active lease", () => {
  const result = applyLiveControlAction({
    action: "release",
    clientId: "remote-a",
    existingLease: null,
    source: "remote",
    threadId: "thread-1",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 4, 0)
  });

  assert.equal(result.lease, null);
  assert.equal(result.event, null);
  assert.equal(result.recordEvent, false);
});

test("agent cannot claim over an existing remote lease", () => {
  const existingLease = setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thread-1",
    ttlMs: TTL_MS,
    now: Date.UTC(2026, 2, 18, 23, 5, 0)
  });

  assert.throws(
    () =>
      applyLiveControlAction({
        action: "claim",
        clientId: "agent-a",
        existingLease,
        source: "agent",
        threadId: "thread-1",
        ttlMs: TTL_MS,
        now: Date.UTC(2026, 2, 18, 23, 5, 10)
      }),
    /Remote .* currently holds control/
  );
});
