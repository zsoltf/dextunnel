import test from "node:test";
import assert from "node:assert/strict";

import { createCompanionStateService } from "../src/lib/companion-state.mjs";

function createService(overrides = {}) {
  const liveState = overrides.liveState || {
    companionByThreadId: {},
    pendingInteraction: null,
    selectedThreadId: "thr_dextunnel",
    selectedThreadSnapshot: {
      thread: {
        id: "thr_dextunnel"
      }
    }
  };

  return {
    liveState,
    service: createCompanionStateService({
      ADVISORY_PARTICIPANT_IDS: ["oracle", "gemini"],
      COMPANION_WAKEUP_LIMIT: 4,
      COMPANION_WAKEUP_SNOOZE_MS: 60_000,
      COMPANION_WAKEUP_STALE_MS: 20 * 60_000,
      COMPANION_WAKEUP_VISIBLE_MS: 6 * 60_000,
      buildParticipant: (id, overrides = {}) => ({
        id,
        label: id,
        ...overrides
      }),
      liveState,
      nowIso: () => new Date(Date.now()).toISOString(),
      ...overrides
    })
  };
}

test("companion state can summon and expose a visible advisory wakeup", () => {
  const { service } = createService();

  const result = service.summonCompanionWakeup({ advisorId: "oracle" });
  const selected = service.buildSelectedCompanionState("thr_dextunnel");

  assert.equal(result.advisorId, "oracle");
  assert.equal(selected.wakeups.length, 1);
  assert.equal(selected.wakeups[0].origin, "oracle");
  assert.equal(selected.advisories[0].id, "oracle");
  assert.equal(selected.advisories[0].state, "ready");
});

test("companion wakeup actions can snooze and dismiss active notices", () => {
  const { liveState, service } = createService();
  service.queueCompanionWakeup({
    advisorId: "gemini",
    text: "Summary ready",
    threadId: "thr_dextunnel",
    wakeKey: "wake-1",
    wakeKind: "summary"
  });

  const snoozed = service.applyCompanionWakeupAction({
    action: "snooze",
    threadId: "thr_dextunnel",
    wakeKey: "wake-1"
  });
  assert.equal(snoozed.action, "snooze");
  assert.equal(liveState.companionByThreadId.thr_dextunnel.wakeups[0].status, "snoozed");

  liveState.companionByThreadId.thr_dextunnel.wakeups[0] = {
    ...liveState.companionByThreadId.thr_dextunnel.wakeups[0],
    status: "ready",
    snoozeUntil: null
  };

  const dismissed = service.applyCompanionWakeupAction({
    action: "dismiss",
    threadId: "thr_dextunnel",
    wakeKey: "wake-1"
  });
  assert.equal(dismissed.action, "dismiss");
  assert.equal(liveState.companionByThreadId.thr_dextunnel.wakeups[0].status, "dismissed");
});

test("companion wakeups respect pending interaction and can be reset", () => {
  const { liveState, service } = createService({
    liveState: {
      companionByThreadId: {},
      pendingInteraction: {
        threadId: "thr_dextunnel"
      },
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: {
        thread: {
          id: "thr_dextunnel"
        }
      }
    }
  });

  const blocked = service.queueCompanionWakeup({
    advisorId: "oracle",
    text: "Review ready",
    threadId: "thr_dextunnel",
    wakeKey: "wake-2",
    wakeKind: "review"
  });
  assert.equal(blocked, false);

  liveState.pendingInteraction = null;
  const queued = service.queueCompanionWakeup({
    advisorId: "oracle",
    text: "Review ready",
    threadId: "thr_dextunnel",
    wakeKey: "wake-3",
    wakeKind: "review"
  });
  assert.equal(queued, true);
  assert.equal(service.resetCompanionWakeups("thr_dextunnel"), true);
  assert.deepEqual(service.buildSelectedCompanionState("thr_dextunnel").wakeups, []);
});
