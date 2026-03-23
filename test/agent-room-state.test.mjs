import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultAgentRoomState,
  getAgentRoomRetryRound,
  normalizeAgentRoomState,
  setAgentRoomEnabled,
  startAgentRoomRound,
  settleAgentRoomParticipant,
  interruptAgentRoomRound
} from "../src/lib/agent-room-state.mjs";

test("agent room can be enabled without losing default members", () => {
  const state = setAgentRoomEnabled(defaultAgentRoomState({ threadId: "thread-1" }), true, {
    timestamp: "2026-03-19T00:00:00.000Z"
  });

  assert.equal(state.enabled, true);
  assert.deepEqual(state.memberIds, ["nix", "spark", "gemini", "claude", "oracle"]);
});

test("agent room round appends a user prompt and tracks pending members", () => {
  const started = startAgentRoomRound(
    defaultAgentRoomState({ enabled: true, threadId: "thread-1" }),
    {
      messageId: "msg-1",
      participantIds: ["nix", "gemini"],
      roundId: "round-1",
      text: "Please discuss the latest diff.",
      timestamp: "2026-03-19T00:00:00.000Z"
    }
  );

  assert.equal(started.messages.length, 1);
  assert.equal(started.messages[0].role, "user");
  assert.equal(started.currentRound.id, "round-1");
  assert.deepEqual(started.currentRound.pendingParticipantIds, ["nix", "gemini"]);
});

test("agent room round settles lane replies and marks partial completion", () => {
  const started = startAgentRoomRound(
    defaultAgentRoomState({ enabled: true, threadId: "thread-1" }),
    {
      messageId: "msg-1",
      participantIds: ["nix", "gemini"],
      roundId: "round-1",
      text: "Please discuss the latest diff.",
      timestamp: "2026-03-19T00:00:00.000Z"
    }
  );

  const afterNix = settleAgentRoomParticipant(started, {
    messageId: "reply-1",
    participantId: "nix",
    roundId: "round-1",
    text: "Nix reply",
    timestamp: "2026-03-19T00:00:01.000Z"
  });
  assert.deepEqual(afterNix.currentRound.pendingParticipantIds, ["gemini"]);

  const afterGemini = settleAgentRoomParticipant(afterNix, {
    error: "timeout",
    messageId: "reply-2",
    participantId: "gemini",
    roundId: "round-1",
    text: "",
    timestamp: "2026-03-19T00:00:02.000Z"
  });

  assert.equal(afterGemini.currentRound.status, "partial");
  assert.equal(afterGemini.messages.length, 3);
  assert.match(afterGemini.messages.at(-1).text, /gemini failed/i);
  assert.equal(afterGemini.currentRound.completedAt, "2026-03-19T00:00:02.000Z");
  assert.equal(afterGemini.currentRound.lastErrorByParticipant.gemini, "timeout");
});

test("agent room exposes a retry draft for failed participants only", () => {
  const started = startAgentRoomRound(
    defaultAgentRoomState({ enabled: true, threadId: "thread-1" }),
    {
      messageId: "msg-1",
      participantIds: ["nix", "gemini", "oracle"],
      roundId: "round-1",
      text: "Please review the launch risk.",
      timestamp: "2026-03-19T00:00:00.000Z"
    }
  );

  const afterNix = settleAgentRoomParticipant(started, {
    messageId: "reply-1",
    participantId: "nix",
    roundId: "round-1",
    text: "Nix reply",
    timestamp: "2026-03-19T00:00:01.000Z"
  });
  const afterGemini = settleAgentRoomParticipant(afterNix, {
    error: "gemini timed out after 5000ms.",
    messageId: "reply-2",
    participantId: "gemini",
    roundId: "round-1",
    text: "",
    timestamp: "2026-03-19T00:00:02.000Z"
  });
  const afterOracle = settleAgentRoomParticipant(afterGemini, {
    error: "oracle returned a malformed reply.",
    messageId: "reply-3",
    participantId: "oracle",
    roundId: "round-1",
    text: "",
    timestamp: "2026-03-19T00:00:03.000Z"
  });

  const retry = getAgentRoomRetryRound(afterOracle);
  assert.deepEqual(retry?.participantIds, ["gemini", "oracle"]);
  assert.equal(retry?.promptText, "Please review the launch risk.");
  assert.equal(retry?.retryCount, 1);
  assert.match(retry?.note || "", /retry/i);
});

test("normalizing loaded room state interrupts stale running rounds", () => {
  const state = normalizeAgentRoomState({
    currentRound: {
      completedParticipantIds: [],
      failedParticipantIds: [],
      id: "round-1",
      messageId: "msg-1",
      participantIds: ["nix"],
      pendingParticipantIds: ["nix"],
      startedAt: "2026-03-19T00:00:00.000Z",
      status: "running"
    },
    enabled: true,
    memberIds: ["nix"],
    messages: [],
    threadId: "thread-1"
  }, {
    threadId: "thread-1",
    timestamp: "2026-03-19T00:00:02.000Z"
  });

  const interrupted = interruptAgentRoomRound(state, {
    note: "Council round stopped when Dextunnel restarted.",
    timestamp: "2026-03-19T00:00:03.000Z"
  });

  assert.equal(interrupted.currentRound, null);
  assert.match(interrupted.messages.at(-1).text, /restarted/i);
});

test("normalizing a completed round preserves empty pending lists", () => {
  const state = normalizeAgentRoomState({
    currentRound: {
      completedParticipantIds: ["nix", "gemini"],
      failedParticipantIds: [],
      id: "round-1",
      messageId: "msg-1",
      participantIds: ["nix", "gemini"],
      pendingParticipantIds: [],
      startedAt: "2026-03-19T00:00:00.000Z",
      status: "complete"
    },
    enabled: true,
    memberIds: ["nix", "gemini"],
    messages: [],
    threadId: "thread-1"
  }, {
    threadId: "thread-1",
    timestamp: "2026-03-19T00:00:02.000Z"
  });

  assert.deepEqual(state.currentRound.pendingParticipantIds, []);
  assert.deepEqual(state.currentRound.completedParticipantIds, ["nix", "gemini"]);
  assert.deepEqual(state.currentRound.failedParticipantIds, []);
});

test("normalizing loaded room state cleans historical oracle wrapper chatter", () => {
  const state = normalizeAgentRoomState({
    enabled: true,
    memberIds: ["oracle"],
    messages: [
      {
        id: "oracle-1",
        lane: "oracle",
        note: "council reply",
        participantId: "oracle",
        role: "assistant",
        text: [
          "🧿 oracle 0.9.0 — One command, several seers; results stay grounded.",
          "Launching browser mode (gpt-5.4-pro) with ~1,273 tokens.",
          "This run can take up to an hour (usually ~10 minutes).",
          "Answer:",
          "Oracle: clean output ok.",
          "",
          "3m34s · gpt-5.4-pro[browser] · ↑1.27k ↓45 ↻0 Δ1.32k",
          "files=1"
        ].join("\n"),
        timestamp: "2026-03-20T00:00:00.000Z"
      }
    ],
    threadId: "thread-1"
  }, {
    threadId: "thread-1",
    timestamp: "2026-03-20T00:00:02.000Z"
  });

  assert.equal(state.messages[0].text, "Oracle: clean output ok.");
});
