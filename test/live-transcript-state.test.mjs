import test from "node:test";
import assert from "node:assert/strict";

import { createLiveTranscriptStateService } from "../src/lib/live-transcript-state.mjs";

function createService(overrides = {}) {
  const liveState = overrides.liveState || {
    lastError: "stale",
    lastSyncAt: null,
    selectedProjectCwd: "/tmp/codex/dextunnel",
    selectedThreadId: "thr_dextunnel",
    selectedThreadSnapshot: null,
    threads: [
      {
        cwd: "/tmp/codex/dextunnel",
        id: "thr_dextunnel",
        name: "dextunnel",
        preview: "preview",
        source: "vscode",
        status: "idle",
        updatedAt: "2026-03-20T12:00:00.000Z"
      }
    ]
  };

  const nowValues = overrides.nowValues || [
    "2026-03-20T12:34:56.000Z",
    "2026-03-20T12:34:57.000Z",
    "2026-03-20T12:34:58.000Z"
  ];
  let nowIndex = 0;

  return {
    liveState,
    service: createLiveTranscriptStateService({
      extractNotificationDelta: (params = {}) => params.delta || params.textDelta || "",
      getDefaultCwd: () => "/tmp/codex/default",
      liveState,
      mapThreadItemToCompanionEntry: (item, turn) => ({
        itemId: item.id || null,
        kind: item.type === "contextCompaction" ? "system" : item.kind || "message",
        role: item.role || (item.type === "userMessage" ? "user" : "assistant"),
        text: item.text || item.label || item.type || "",
        timestamp: turn.updatedAt,
        turnId: turn.id || null
      }),
      nowIso: () => {
        const value = nowValues[Math.min(nowIndex, nowValues.length - 1)];
        nowIndex += 1;
        return value;
      },
      visibleTranscriptLimit: 3,
      ...overrides
    })
  };
}

test("watcher ignores notifications for non-selected threads", () => {
  const { liveState, service } = createService();

  const changed = service.applyWatcherNotification(
    {
      method: "turn/started",
      params: {
        threadId: "thr_other",
        turn: { id: "turn_other", status: "inProgress" }
      }
    },
    {
      cwd: "/tmp/codex/other",
      threadId: "thr_other"
    }
  );

  assert.equal(changed, false);
  assert.equal(liveState.selectedThreadSnapshot, null);
});

test("turn lifecycle updates selected snapshot and thread summary", () => {
  const { liveState, service } = createService();

  const changed = service.applyWatcherNotification(
    {
      method: "turn/started",
      params: {
        threadId: "thr_dextunnel",
        turn: {
          id: "turn_live",
          status: "inProgress",
          updatedAt: "2026-03-20T12:40:00.000Z"
        }
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );

  assert.equal(changed, true);
  assert.equal(liveState.selectedThreadSnapshot.thread.activeTurnId, "turn_live");
  assert.equal(liveState.selectedThreadSnapshot.thread.lastTurnStatus, "inProgress");
  assert.equal(liveState.threads[0].status, "inProgress");
  assert.equal(liveState.lastError, null);
  assert.equal(liveState.lastSyncAt, "2026-03-20T12:34:57.000Z");
});

test("item updates and deltas append into transcript entries", () => {
  const { liveState, service } = createService();

  const started = service.applyWatcherNotification(
    {
      method: "item/started",
      params: {
        item: {
          id: "item_msg",
          role: "assistant",
          text: "Hello"
        },
        threadId: "thr_dextunnel",
        turnId: "turn_live"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );
  const delta = service.applyWatcherNotification(
    {
      method: "item/agentMessage/delta",
      params: {
        itemId: "item_msg",
        textDelta: " world",
        threadId: "thr_dextunnel",
        turnId: "turn_live"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );

  assert.equal(started, true);
  assert.equal(delta, true);
  assert.equal(liveState.selectedThreadSnapshot.transcript.length, 1);
  assert.equal(liveState.selectedThreadSnapshot.transcript[0].text, "Hello world");
});

test("reasoning and output deltas preserve separators", () => {
  const { liveState, service } = createService();
  service.applyWatcherNotification(
    {
      method: "item/started",
      params: {
        item: {
          id: "item_reasoning",
          kind: "reasoning",
          role: "system",
          text: "step 1"
        },
        threadId: "thr_dextunnel",
        turnId: "turn_live"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );
  service.applyWatcherNotification(
    {
      method: "item/reasoning/summaryPartAdded",
      params: {
        itemId: "item_reasoning",
        threadId: "thr_dextunnel",
        turnId: "turn_live"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );
  service.applyWatcherNotification(
    {
      method: "item/reasoning/textDelta",
      params: {
        itemId: "item_reasoning",
        textDelta: "step 2",
        threadId: "thr_dextunnel",
        turnId: "turn_live"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );

  service.applyWatcherNotification(
    {
      method: "item/started",
      params: {
        item: {
          id: "item_cmd",
          kind: "tool",
          role: "system",
          text: "npm test"
        },
        threadId: "thr_dextunnel",
        turnId: "turn_live"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );
  service.applyWatcherNotification(
    {
      method: "item/commandExecution/outputDelta",
      params: {
        delta: "PASS",
        itemId: "item_cmd",
        threadId: "thr_dextunnel",
        turnId: "turn_live"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );

  const [reasoning, command] = liveState.selectedThreadSnapshot.transcript;
  assert.equal(reasoning.text, "step 1\n\nstep 2");
  assert.equal(command.text, "npm test\nPASS");
});

test("thread name, status, token usage, and plan updates mutate selected thread state", () => {
  const { liveState, service } = createService();

  service.applyWatcherNotification(
    {
      method: "thread/name/updated",
      params: {
        name: "Bootstrap repo workflow scaffold",
        threadId: "thr_dextunnel"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );
  service.applyWatcherNotification(
    {
      method: "thread/status/changed",
      params: {
        status: "completed",
        threadId: "thr_dextunnel"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );
  service.applyWatcherNotification(
    {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thr_dextunnel",
        tokenUsage: {
          inputTokens: 12,
          outputTokens: 34
        }
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );
  service.applyWatcherNotification(
    {
      method: "turn/plan/updated",
      params: {
        explanation: "Ship boring trust first",
        plan: [{ status: "in_progress", step: "Stabilize daemon" }],
        threadId: "thr_dextunnel",
        turnId: "turn_live"
      }
    },
    {
      cwd: "/tmp/codex/dextunnel",
      threadId: "thr_dextunnel"
    }
  );

  assert.equal(liveState.selectedThreadSnapshot.thread.name, "Bootstrap repo workflow scaffold");
  assert.equal(liveState.selectedThreadSnapshot.thread.status, "completed");
  assert.deepEqual(liveState.selectedThreadSnapshot.thread.tokenUsage, {
    inputTokens: 12,
    outputTokens: 34
  });
  assert.deepEqual(liveState.selectedThreadSnapshot.thread.livePlan, [
    { status: "in_progress", step: "Stabilize daemon" }
  ]);
  assert.equal(liveState.threads[0].name, "Bootstrap repo workflow scaffold");
  assert.equal(liveState.threads[0].status, "completed");
});

test("transcript entries are clamped to the visible limit", () => {
  const { liveState, service } = createService();

  for (const itemId of ["item_a", "item_b", "item_c", "item_d"]) {
    service.applyWatcherNotification(
      {
        method: "item/started",
        params: {
          item: {
            id: itemId,
            role: "assistant",
            text: itemId
          },
          threadId: "thr_dextunnel",
          turnId: "turn_live"
        }
      },
      {
        cwd: "/tmp/codex/dextunnel",
        threadId: "thr_dextunnel"
      }
    );
  }

  assert.deepEqual(
    liveState.selectedThreadSnapshot.transcript.map((entry) => entry.itemId),
    ["item_b", "item_c", "item_d"]
  );
  assert.equal(liveState.selectedThreadSnapshot.transcriptCount, 4);
});
