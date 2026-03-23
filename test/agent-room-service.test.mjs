import test from "node:test";
import assert from "node:assert/strict";

import {
  createAgentRoomMessage,
  defaultAgentRoomState,
  getAgentRoomRetryRound,
  interruptAgentRoomRound,
  normalizeAgentRoomState,
  setAgentRoomEnabled,
  settleAgentRoomParticipant,
  startAgentRoomRound
} from "../src/lib/agent-room-state.mjs";
import { createAgentRoomService } from "../src/lib/agent-room-service.mjs";

function createService(overrides = {}) {
  const calls = [];
  const liveState = overrides.liveState || {
    agentRoomByThreadId: {},
    selectedThreadId: "thr_dextunnel",
    selectedThreadSnapshot: {
      thread: {
        id: "thr_dextunnel"
      }
    }
  };

  const persistedStates = new Map();

  const service = createAgentRoomService({
    buildAgentRoomContextMarkdown: ({ threadId }) => `context:${threadId}`,
    buildLivePayload: () => ({ ok: true }),
    buildParticipant: (id, overrides = {}) => ({ id, ...overrides }),
    broadcast: (event, payload) => calls.push(["broadcast", event, payload]),
    codexAppServer: {
      readThread: async (threadId) => ({
        cwd: "/tmp/codex/dextunnel",
        id: threadId,
        items: [],
        name: "Dextunnel"
      })
    },
    defaultAgentRoomState,
    getAgentRoomRetryRound,
    interruptAgentRoomRound,
    liveState,
    mapThreadToCompanionSnapshot: (thread) => ({ thread, transcript: [] }),
    normalizeAgentRoomState,
    nowIso: () => "2026-03-20T23:00:00.000Z",
    persistState: async (target, value, options = {}) => {
      calls.push(["persistState", target, options.raw === true ? "raw" : "state"]);
      if (!options.raw) {
        persistedStates.set(target, value);
      }
    },
    randomId: (() => {
      let index = 0;
      return () => `id-${++index}`;
    })(),
    runtime: {
      prepareRound: async ({ roundId, threadId }) => ({
        contextFile: `/tmp/${threadId}-${roundId}.md`,
        roundDir: `/tmp/${roundId}`
      }),
      runParticipant: async ({ participantId }) => `reply:${participantId}`
    },
    setAgentRoomEnabled,
    settleAgentRoomParticipant,
    startAgentRoomRound,
    store: {
      load: async (threadId) => persistedStates.get(threadId) || defaultAgentRoomState({ threadId })
    },
    ...overrides
  });

  return {
    calls,
    liveState,
    persistedStates,
    service
  };
}

test("agent room service enables a room and shapes selected room state", async () => {
  const { calls, liveState, service } = createService();

  const enabled = await service.updateAgentRoom({
    action: "enable",
    memberIds: ["gemini", "oracle"],
    threadId: "thr_dextunnel"
  });

  assert.equal(enabled.state.enabled, true);
  assert.deepEqual(enabled.state.memberIds, ["gemini", "oracle"]);
  const selected = service.buildSelectedAgentRoomState("thr_dextunnel");
  assert.equal(selected.enabled, true);
  assert.equal(selected.participants.length, 2);
  assert.ok(calls.some((entry) => entry[0] === "persistState"));
  assert.equal(liveState.agentRoomByThreadId.thr_dextunnel.enabled, true);
});

test("agent room service starts and settles a council round", async () => {
  const { calls, service } = createService({
    liveState: {
      agentRoomByThreadId: {
        thr_dextunnel: defaultAgentRoomState({
          enabled: true,
          memberIds: ["gemini", "oracle"],
          threadId: "thr_dextunnel"
        })
      },
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: {
        thread: {
          id: "thr_dextunnel"
        }
      }
    }
  });

  const started = await service.updateAgentRoom({
    action: "send",
    text: "Discuss launch risk",
    threadId: "thr_dextunnel"
  });
  assert.equal(started.message, "Council round started.");

  await new Promise((resolve) => setTimeout(resolve, 0));

  const selected = service.buildSelectedAgentRoomState("thr_dextunnel");
  assert.equal(selected.messages.length, 3);
  assert.equal(selected.round?.status, "complete");
  assert.equal(selected.round?.completedCount, 2);
  assert.ok(
    calls.some((entry) => entry[0] === "broadcast"),
    "live broadcasts should happen as participants settle"
  );
});

test("agent room service retries failed participants only", async () => {
  const failingOnce = new Set(["oracle"]);
  const { service } = createService({
    liveState: {
      agentRoomByThreadId: {
        thr_dextunnel: defaultAgentRoomState({
          enabled: true,
          memberIds: ["gemini", "oracle"],
          threadId: "thr_dextunnel"
        })
      },
      selectedThreadId: "thr_dextunnel",
      selectedThreadSnapshot: {
        thread: {
          id: "thr_dextunnel"
        }
      }
    },
    runtime: {
      prepareRound: async ({ roundId, threadId }) => ({
        contextFile: `/tmp/${threadId}-${roundId}.md`,
        roundDir: `/tmp/${roundId}`
      }),
      runParticipant: async ({ participantId }) => {
        if (failingOnce.has(participantId)) {
          failingOnce.delete(participantId);
          throw new Error("lane timeout");
        }
        return `reply:${participantId}`;
      }
    }
  });

  await service.updateAgentRoom({
    action: "send",
    text: "Need second opinions",
    threadId: "thr_dextunnel"
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const partial = service.buildSelectedAgentRoomState("thr_dextunnel");
  assert.equal(partial.round?.status, "partial");
  assert.equal(partial.round?.failedCount, 1);
  assert.equal(getAgentRoomRetryRound(service.getThreadAgentRoomState("thr_dextunnel"))?.participantIds[0], "oracle");

  await service.updateAgentRoom({
    action: "retry",
    threadId: "thr_dextunnel"
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const completed = service.buildSelectedAgentRoomState("thr_dextunnel");
  assert.equal(completed.round?.status, "complete");
  assert.equal(completed.round?.failedCount, 0);
});
