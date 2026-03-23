import test from "node:test";
import assert from "node:assert/strict";

import { createInteractionStateService } from "../src/lib/interaction-state.mjs";

function createService(overrides = {}) {
  const appServerState = overrides.appServerState || {
    lastControlEvent: null,
    lastInteraction: null,
    lastSelectionEvent: null,
    lastSurfaceEvent: null,
    lastWrite: null
  };
  const liveState = overrides.liveState || {
    interactionFlow: null,
    pendingInteraction: null,
    selectedThreadId: "thr_dextunnel"
  };
  const nowValues = overrides.nowValues || [
    "2026-03-20T16:10:00.000Z",
    "2026-03-20T16:10:01.000Z"
  ];
  let nowIndex = 0;

  return {
    appServerState,
    liveState,
    service: createInteractionStateService({
      appServerState,
      liveState,
      nowIso: () => {
        const value = nowValues[Math.min(nowIndex, nowValues.length - 1)];
        nowIndex += 1;
        return value;
      },
      trimInteractionText: (value, maxLength = 72) => String(value || "").trim().slice(0, maxLength),
      ...overrides
    })
  };
}

test("interaction flow increments step and retry for repeated requests in the same turn", () => {
  const { appServerState, liveState, service } = createService({
    appServerState: {
      lastInteraction: {
        action: "decline",
        threadId: "thr_dextunnel",
        turnId: "turn_live"
      }
    },
    liveState: {
      interactionFlow: null,
      pendingInteraction: null,
      selectedThreadId: "thr_dextunnel"
    }
  });

  const request = {
    method: "item/fileChange/requestApproval",
    params: {
      changes: [{ path: "src/server.mjs" }],
      threadId: "thr_dextunnel",
      turnId: "turn_live"
    },
    requestId: "req_1"
  };

  const firstFlow = service.beginInteractionFlow(request);
  const secondFlow = service.beginInteractionFlow({
    ...request,
    requestId: "req_2"
  });

  assert.equal(firstFlow.step, 1);
  assert.equal(firstFlow.retryAttempt, 1);
  assert.equal(secondFlow.step, 2);
  assert.equal(secondFlow.retryAttempt, 2);
  assert.equal(secondFlow.previousAction, "decline");
  assert.equal(liveState.interactionFlow.requestId, "req_2");
});

test("mapPendingInteraction builds user-input prompts with tool-aware summaries", () => {
  const { service } = createService();

  const request = {
    method: "item/tool/requestUserInput",
    params: {
      itemId: "item_tool",
      questions: [
        {
          header: "Browser",
          question: 'Do you want to allow tool "browser_resize"?'
        }
      ],
      threadId: "thr_dextunnel",
      turnId: "turn_live"
    },
    requestId: "req_tool"
  };

  const flow = service.beginInteractionFlow(request);
  const pending = service.mapPendingInteraction(request, flow);

  assert.equal(pending.kind, "tool_input");
  assert.equal(pending.summary, "browser_resize approval");
  assert.equal(pending.submitLabel, "Submit");
  assert.match(pending.flowContinuation, /Codex needs this input/i);
});

test("summarizeNotificationInteraction keeps pending metadata and selected-thread getters stay scoped", () => {
  const { appServerState, liveState, service } = createService({
    appServerState: {
      lastControlEvent: {
        id: "ctrl_selected",
        threadId: "thr_dextunnel"
      },
      lastInteraction: {
        id: "interaction_other",
        threadId: "thr_other"
      },
      lastSelectionEvent: {
        id: "selection_selected",
        threadId: "thr_dextunnel"
      },
      lastSurfaceEvent: {
        id: "surface_selected",
        threadId: "thr_dextunnel"
      },
      lastWrite: {
        id: "write_other",
        threadId: "thr_other"
      }
    },
    liveState: {
      interactionFlow: null,
      pendingInteraction: {
        requestId: "pending_selected",
        threadId: "thr_dextunnel"
      },
      selectedThreadId: "thr_dextunnel"
    }
  });

  const pending = {
    detail: "Needs approval",
    flowContinuation: "Continuing permissions in the same turn.",
    flowLabel: "Step 2 of the live flow",
    flowStep: 2,
    kind: "permissions",
    kindLabel: "Permissions",
    retryAttempt: 2,
    summary: "permissions",
    threadId: "thr_dextunnel",
    turnId: "turn_live"
  };
  const request = {
    method: "item/permissions/requestApproval",
    params: {
      itemId: "item_perm",
      threadId: "thr_dextunnel",
      turnId: "turn_live"
    },
    requestId: "req_perm"
  };

  const summary = service.summarizeNotificationInteraction(pending, request);

  assert.equal(summary.status, "pending");
  assert.equal(summary.retryAttempt, 2);
  assert.equal(service.getLastInteractionForSelectedThread(), null);
  assert.equal(service.getPendingInteractionForSelectedThread().requestId, "pending_selected");
  assert.equal(service.getLastWriteForSelectedThread(), null);
  assert.equal(service.getLastControlEventForSelectedThread().id, "ctrl_selected");
  assert.equal(service.getLastSelectionEventForSelectedThread().id, "selection_selected");
  assert.equal(service.getLastSurfaceEventForSelectedThread().id, "surface_selected");

  liveState.selectedThreadId = null;
  assert.equal(service.getLastInteractionForSelectedThread().id, "interaction_other");
  assert.equal(service.getLastWriteForSelectedThread().id, "write_other");
});

test("clearInteractionFlow only clears matching thread state", () => {
  const { liveState, service } = createService({
    liveState: {
      interactionFlow: {
        requestId: "req_1",
        threadId: "thr_dextunnel"
      },
      pendingInteraction: null,
      selectedThreadId: "thr_dextunnel"
    }
  });

  service.clearInteractionFlow({ threadId: "thr_other" });
  assert.equal(liveState.interactionFlow.requestId, "req_1");

  service.clearInteractionFlow({ threadId: "thr_dextunnel" });
  assert.equal(liveState.interactionFlow, null);
});
