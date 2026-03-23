import test from "node:test";
import assert from "node:assert/strict";

import {
  applySurfacePresenceUpdate,
  buildSelectedAttachments,
  ensureControlActionAllowed,
  ensureRemoteControlLease,
  pruneStaleSurfacePresence,
  setControlLease
} from "../src/lib/shared-room-state.mjs";

test("first surface attach emits an opened event, second attach only increments count", () => {
  const threadId = "thread-1";
  const first = applySurfacePresenceUpdate(
    {},
    {
      clientId: "remote-a",
      engaged: true,
      focused: true,
      surface: "remote",
      threadId,
      visible: true
    },
    {
      now: Date.UTC(2026, 2, 18, 22, 0, 0)
    }
  );

  assert.equal(first.changed, true);
  assert.deepEqual(first.events.map((event) => ({ action: event.action, cause: event.cause })), [
    { action: "attach", cause: "opened" }
  ]);

  const second = applySurfacePresenceUpdate(
    first.nextPresenceByClientId,
    {
      clientId: "remote-b",
      engaged: false,
      focused: false,
      surface: "remote",
      threadId,
      visible: true
    },
    {
      now: Date.UTC(2026, 2, 18, 22, 0, 2)
    }
  );

  assert.equal(second.changed, true);
  assert.deepEqual(second.events, []);
  assert.deepEqual(buildSelectedAttachments(second.nextPresenceByClientId, threadId), [
    {
      count: 2,
      label: "remote",
      state: "viewing",
      surface: "remote"
    }
  ]);
});

test("moving the last host presence emits detach and attach move events", () => {
  const opened = applySurfacePresenceUpdate(
    {},
    {
      clientId: "host-a",
      engaged: true,
      focused: true,
      surface: "host",
      threadId: "thread-a",
      visible: true
    },
    {
      now: Date.UTC(2026, 2, 18, 22, 1, 0)
    }
  );

  const moved = applySurfacePresenceUpdate(
    opened.nextPresenceByClientId,
    {
      clientId: "host-a",
      engaged: true,
      focused: true,
      surface: "host",
      threadId: "thread-b",
      visible: true
    },
    {
      now: Date.UTC(2026, 2, 18, 22, 1, 4)
    }
  );

  assert.equal(moved.changed, true);
  assert.deepEqual(
    moved.events.map((event) => ({
      action: event.action,
      cause: event.cause,
      surface: event.surface,
      threadId: event.threadId
    })),
    [
      { action: "detach", cause: "moved", surface: "host", threadId: "thread-a" },
      { action: "attach", cause: "moved", surface: "host", threadId: "thread-b" }
    ]
  );
});

test("stale presence pruning emits detach when the last surface ages out", () => {
  const updatedAt = new Date(Date.UTC(2026, 2, 18, 22, 2, 0)).toISOString();
  const stale = pruneStaleSurfacePresence(
    {
      "remote-a": {
        clientId: "remote-a",
        engaged: false,
        focused: false,
        label: "remote",
        surface: "remote",
        threadId: "thread-1",
        updatedAt,
        visible: true
      }
    },
    {
      now: Date.UTC(2026, 2, 18, 22, 3, 0),
      staleMs: 45 * 1000
    }
  );

  assert.equal(stale.changed, true);
  assert.deepEqual(
    stale.events.map((event) => ({ action: event.action, cause: event.cause, threadId: event.threadId })),
    [{ action: "detach", cause: "stale", threadId: "thread-1" }]
  );
  assert.deepEqual(stale.nextPresenceByClientId, {});
});

test("control lease is bound to a specific remote client", () => {
  const lease = setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thread-1",
    ttlMs: 5 * 60 * 1000,
    now: Date.UTC(2026, 2, 18, 22, 4, 0)
  });

  const renewed = ensureRemoteControlLease({
    clientId: "remote-a",
    lease,
    now: Date.UTC(2026, 2, 18, 22, 4, 30),
    threadId: "thread-1",
    ttlMs: 5 * 60 * 1000
  });

  assert.equal(renewed.ownerClientId, "remote-a");
  assert.match(renewed.ownerLabel, /^Remote /);

  assert.throws(
    () =>
      ensureRemoteControlLease({
        clientId: "remote-b",
        lease,
        now: Date.UTC(2026, 2, 18, 22, 4, 45),
        threadId: "thread-1",
        ttlMs: 5 * 60 * 1000
      }),
    /Another remote surface currently holds control/
  );
});

test("control lease rejects remote send when another surface owns the lease", () => {
  const lease = setControlLease({
    clientId: "host-a",
    owner: "host",
    reason: "observe",
    source: "host",
    threadId: "thread-1",
    ttlMs: 5 * 60 * 1000,
    now: Date.UTC(2026, 2, 18, 22, 5, 0)
  });

  assert.throws(
    () =>
      ensureRemoteControlLease({
        clientId: "remote-a",
        lease,
        now: Date.UTC(2026, 2, 18, 22, 5, 10),
        threadId: "thread-1",
        ttlMs: 5 * 60 * 1000
      }),
    /Host .* currently holds control for this channel/
  );
});

test("another remote cannot claim control over an existing remote lease", () => {
  const lease = setControlLease({
    clientId: "remote-a",
    owner: "remote",
    reason: "compose",
    source: "remote",
    threadId: "thread-1",
    ttlMs: 5 * 60 * 1000,
    now: Date.UTC(2026, 2, 18, 22, 6, 0)
  });

  assert.throws(
    () =>
      ensureControlActionAllowed({
        action: "claim",
        clientId: "remote-b",
        lease,
        source: "remote",
        threadId: "thread-1",
        now: Date.UTC(2026, 2, 18, 22, 6, 5)
      }),
    /Another remote surface currently holds control/
  );
});

test("remote claim is blocked when a non-remote surface owns the lease", () => {
  const lease = setControlLease({
    clientId: "host-a",
    owner: "host",
    reason: "observe",
    source: "host",
    threadId: "thread-1",
    ttlMs: 5 * 60 * 1000,
    now: Date.UTC(2026, 2, 18, 22, 7, 0)
  });

  assert.throws(
    () =>
      ensureControlActionAllowed({
        action: "claim",
        clientId: "remote-a",
        lease,
        source: "remote",
        threadId: "thread-1",
        now: Date.UTC(2026, 2, 18, 22, 7, 10)
      }),
    /Host .* currently holds control for this channel/
  );
});
