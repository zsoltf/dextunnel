import test from "node:test";
import assert from "node:assert/strict";

import {
  applySurfacePresenceUpdate as applySurfacePresenceUpdateState,
  buildSelectedAttachments as buildSelectedAttachmentsState,
  countSurfacePresence as countSurfacePresenceState,
  pruneStaleSurfacePresence as pruneStaleSurfacePresenceState
} from "../src/lib/shared-room-state.mjs";
import { createSurfacePresenceService } from "../src/lib/surface-presence-service.mjs";

function createService(overrides = {}) {
  const liveState = overrides.liveState || {
    selectedThreadId: "thread-1",
    selectedThreadSnapshot: { thread: { id: "thread-1" } },
    surfacePresenceByClientId: {}
  };
  const appServerState = overrides.appServerState || {
    lastSurfaceEvent: null
  };

  return {
    appServerState,
    liveState,
    service: createSurfacePresenceService({
      appServerState,
      applySurfacePresenceUpdateState,
      buildSelectedAttachmentsState,
      countSurfacePresenceState,
      liveState,
      normalizeSurfaceName: (value) => String(value || "").trim().toLowerCase(),
      nowIso: () => "2026-03-20T20:15:00.000Z",
      pruneStaleSurfacePresenceState,
      randomId: () => "surface-event-1",
      ...overrides
    })
  };
}

test("surface presence service applies updates and records emitted events", () => {
  const { appServerState, liveState, service } = createService();

  const changed = service.applySurfacePresenceUpdate(
    {
      clientId: "remote-a",
      engaged: true,
      focused: true,
      surface: "remote",
      threadId: "thread-1",
      visible: true
    },
    {
      now: Date.UTC(2026, 2, 20, 20, 15, 0),
      selectedThreadId: "thread-1"
    }
  );

  assert.equal(changed, true);
  assert.equal(service.countSurfacePresence("thread-1", "remote"), 1);
  assert.equal(appServerState.lastSurfaceEvent?.id, "surface-event-1");
  assert.equal(appServerState.lastSurfaceEvent?.action, "attach");
  assert.deepEqual(service.buildSelectedAttachments("thread-1"), [
    {
      count: 1,
      label: "remote",
      state: "active",
      surface: "remote"
    }
  ]);
  assert.ok(liveState.surfacePresenceByClientId["remote-a"]);
});

test("surface presence service prunes stale entries and records detach events", () => {
  const { appServerState, liveState, service } = createService({
    liveState: {
      selectedThreadId: "thread-1",
      selectedThreadSnapshot: { thread: { id: "thread-1" } },
      surfacePresenceByClientId: {
        "remote-a": {
          clientId: "remote-a",
          engaged: false,
          focused: false,
          label: "remote",
          surface: "remote",
          threadId: "thread-1",
          updatedAt: new Date(Date.UTC(2026, 2, 20, 20, 0, 0)).toISOString(),
          visible: true
        }
      }
    }
  });

  const changed = service.pruneStaleSurfacePresence({
    now: Date.UTC(2026, 2, 20, 20, 2, 0),
    staleMs: 45 * 1000
  });

  assert.equal(changed, true);
  assert.deepEqual(liveState.surfacePresenceByClientId, {});
  assert.equal(appServerState.lastSurfaceEvent?.action, "detach");
  assert.equal(appServerState.lastSurfaceEvent?.cause, "stale");
});

test("surface presence service removes a surface and preserves selected-thread defaults", () => {
  const { liveState, service } = createService();

  service.applySurfacePresenceUpdate(
    {
      clientId: "host-a",
      engaged: false,
      focused: true,
      surface: "host",
      visible: true
    },
    {
      now: Date.UTC(2026, 2, 20, 20, 16, 0),
      selectedThreadId: "thread-1"
    }
  );

  const changed = service.removeSurfacePresence("host-a", {
    now: Date.UTC(2026, 2, 20, 20, 16, 5),
    selectedThreadId: "thread-1"
  });

  assert.equal(changed, true);
  assert.deepEqual(liveState.surfacePresenceByClientId, {});
});
