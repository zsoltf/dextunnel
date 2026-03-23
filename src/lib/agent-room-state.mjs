import { normalizeAgentRoomReply } from "./agent-room-text.mjs";

export const AGENT_ROOM_MEMBER_IDS = ["nix", "spark", "gemini", "claude", "oracle"];
const ROOM_MESSAGE_LIMIT = 120;

function isoNow() {
  return new Date().toISOString();
}

function uniqueIds(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const id = String(value || "").trim().toLowerCase();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function normalizeMemberIds(memberIds = AGENT_ROOM_MEMBER_IDS) {
  const normalized = uniqueIds(memberIds).filter((id) => AGENT_ROOM_MEMBER_IDS.includes(id));
  return normalized.length ? normalized : [...AGENT_ROOM_MEMBER_IDS];
}

function normalizeRoundMemberIds(memberIds, fallback = []) {
  if (!Array.isArray(memberIds)) {
    return Array.isArray(fallback) ? [...fallback] : [];
  }

  return uniqueIds(memberIds).filter((id) => AGENT_ROOM_MEMBER_IDS.includes(id));
}

function normalizeRoundAttemptMap(rawValue, participantIds = []) {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const result = {};
  for (const participantId of participantIds) {
    const value = Number(source[participantId] || 0);
    result[participantId] = Number.isFinite(value) && value > 0 ? value : 0;
  }
  return result;
}

function normalizeRoundErrorMap(rawValue, participantIds = []) {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const result = {};
  for (const participantId of participantIds) {
    const value = String(source[participantId] || "").trim();
    result[participantId] = value || null;
  }
  return result;
}

function clampMessages(messages = []) {
  if (!Array.isArray(messages) || messages.length <= ROOM_MESSAGE_LIMIT) {
    return Array.isArray(messages) ? messages : [];
  }

  return messages.slice(-ROOM_MESSAGE_LIMIT);
}

export function defaultAgentRoomState({
  enabled = false,
  memberIds = AGENT_ROOM_MEMBER_IDS,
  threadId = "",
  timestamp = isoNow()
} = {}) {
  return {
    currentRound: null,
    enabled: Boolean(enabled),
    memberIds: normalizeMemberIds(memberIds),
    messages: [],
    threadId: String(threadId || "").trim() || null,
    updatedAt: timestamp
  };
}

export function normalizeAgentRoomState(rawState, { threadId = "", timestamp = isoNow() } = {}) {
  const base = rawState && typeof rawState === "object" ? rawState : defaultAgentRoomState({ threadId, timestamp });
  const nextThreadId = String(threadId || base.threadId || "").trim() || null;
  const memberIds = normalizeMemberIds(base.memberIds);
  const messages = clampMessages(
    (Array.isArray(base.messages) ? base.messages : [])
      .filter((message) => message && typeof message === "object")
      .map((message) => {
        const participantId =
          String(message.participantId || message.lane || message.origin || "").trim().toLowerCase() || "system";
        return {
          id: String(message.id || "").trim() || null,
          lane: String(message.lane || message.participantId || message.origin || "").trim().toLowerCase() || "system",
          note: String(message.note || "").trim() || null,
          origin: String(message.origin || message.participantId || message.lane || "").trim().toLowerCase() || "system",
          participantId,
          role: message.role === "user" ? "user" : "assistant",
          roundId: String(message.roundId || "").trim() || null,
          text:
            message.role === "user"
              ? String(message.text || "").trim()
              : normalizeAgentRoomReply(participantId, message.text || ""),
          timestamp: String(message.timestamp || "").trim() || timestamp
        };
      })
      .filter((message) => message.id && message.text)
      .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
  );

  let currentRound = null;
  if (base.currentRound && typeof base.currentRound === "object") {
    currentRound = {
      attemptsByParticipant: {},
      completedAt: String(base.currentRound.completedAt || "").trim() || null,
      id: String(base.currentRound.id || "").trim() || null,
      lastErrorByParticipant: {},
      messageId: String(base.currentRound.messageId || "").trim() || null,
      participantIds: normalizeMemberIds(base.currentRound.participantIds || memberIds),
      pendingParticipantIds: normalizeRoundMemberIds(base.currentRound.pendingParticipantIds, []),
      promptText: String(base.currentRound.promptText || "").trim() || null,
      retryCount: Math.max(0, Number(base.currentRound.retryCount || 0) || 0),
      completedParticipantIds: normalizeRoundMemberIds(base.currentRound.completedParticipantIds, []),
      failedParticipantIds: normalizeRoundMemberIds(base.currentRound.failedParticipantIds, []),
      startedAt: String(base.currentRound.startedAt || "").trim() || timestamp,
      status: String(base.currentRound.status || "").trim() || "running"
    };

    currentRound.attemptsByParticipant = normalizeRoundAttemptMap(
      base.currentRound.attemptsByParticipant,
      currentRound.participantIds
    );
    currentRound.lastErrorByParticipant = normalizeRoundErrorMap(
      base.currentRound.lastErrorByParticipant,
      currentRound.participantIds
    );

    if (!currentRound.id) {
      currentRound = null;
    }
  }

  return {
    currentRound,
    enabled: Boolean(base.enabled),
    memberIds,
    messages,
    threadId: nextThreadId,
    updatedAt: String(base.updatedAt || "").trim() || timestamp
  };
}

export function setAgentRoomEnabled(state, enabled, { memberIds = null, timestamp = isoNow() } = {}) {
  const current = normalizeAgentRoomState(state, { timestamp });
  return {
    ...current,
    enabled: Boolean(enabled),
    memberIds: memberIds ? normalizeMemberIds(memberIds) : current.memberIds,
    updatedAt: timestamp
  };
}

export function createAgentRoomMessage({
  id,
  participantId,
  role = "assistant",
  text,
  timestamp = isoNow(),
  roundId = null,
  note = null
} = {}) {
  const nextParticipantId = String(participantId || "").trim().toLowerCase() || "system";
  return {
    id: String(id || "").trim() || null,
    lane: nextParticipantId,
    note: String(note || "").trim() || null,
    origin: nextParticipantId,
    participantId: nextParticipantId,
    role: role === "user" ? "user" : "assistant",
    roundId: String(roundId || "").trim() || null,
    text: String(text || "").trim(),
    timestamp
  };
}

export function appendAgentRoomMessages(state, messages = [], { timestamp = isoNow() } = {}) {
  const current = normalizeAgentRoomState(state, { timestamp });
  const nextMessages = clampMessages([
    ...current.messages,
    ...messages
      .map((message) => normalizeAgentRoomState({
        enabled: current.enabled,
        memberIds: current.memberIds,
        messages: [message],
        threadId: current.threadId
      }, { timestamp }).messages[0])
      .filter(Boolean)
  ]);

  return {
    ...current,
    messages: nextMessages,
    updatedAt: timestamp
  };
}

export function startAgentRoomRound(
  state,
  {
    messageId,
    note = null,
    participantIds = null,
    promptText = null,
    roundId,
    retryCount = 0,
    text,
    timestamp = isoNow(),
    userParticipantId = "remote"
  } = {}
) {
  const current = normalizeAgentRoomState(state, { timestamp });
  if (current.currentRound?.status === "running") {
    throw new Error("The council room is already discussing something.");
  }

  const nextParticipantIds = normalizeMemberIds(participantIds || current.memberIds);
  const nextRoundId = String(roundId || "").trim();
  const nextMessageId = String(messageId || "").trim();
  const userMessage = createAgentRoomMessage({
    id: nextMessageId,
    note: note || `council room / ${nextParticipantIds.length} participants`,
    participantId: userParticipantId,
    role: "user",
    roundId: nextRoundId,
    text,
    timestamp
  });

  return {
    ...appendAgentRoomMessages(current, [userMessage], { timestamp }),
    currentRound: {
      attemptsByParticipant: normalizeRoundAttemptMap(null, nextParticipantIds),
      completedAt: null,
      completedParticipantIds: [],
      failedParticipantIds: [],
      id: nextRoundId,
      lastErrorByParticipant: normalizeRoundErrorMap(null, nextParticipantIds),
      messageId: nextMessageId,
      participantIds: nextParticipantIds,
      pendingParticipantIds: [...nextParticipantIds],
      promptText: String(promptText || text || "").trim() || null,
      retryCount: Math.max(0, Number(retryCount || 0) || 0),
      startedAt: timestamp,
      status: "running"
    },
    enabled: true,
    memberIds: current.memberIds,
    updatedAt: timestamp
  };
}

export function settleAgentRoomParticipant(
  state,
  {
    error = null,
    messageId,
    participantId,
    roundId,
    text,
    timestamp = isoNow()
  } = {}
) {
  const current = normalizeAgentRoomState(state, { timestamp });
  if (!current.currentRound || current.currentRound.id !== String(roundId || "").trim()) {
    return current;
  }

  const nextParticipantId = String(participantId || "").trim().toLowerCase();
  if (!nextParticipantId) {
    return current;
  }

  const pendingParticipantIds = current.currentRound.pendingParticipantIds.filter((id) => id !== nextParticipantId);
  const attemptsByParticipant = {
    ...current.currentRound.attemptsByParticipant,
    [nextParticipantId]: Number(current.currentRound.attemptsByParticipant?.[nextParticipantId] || 0) + 1
  };
  const lastErrorByParticipant = {
    ...current.currentRound.lastErrorByParticipant,
    [nextParticipantId]: error ? String(error || "").trim() || "Unknown error." : null
  };
  const failedParticipantIds = error
    ? uniqueIds([...current.currentRound.failedParticipantIds, nextParticipantId])
    : current.currentRound.failedParticipantIds.filter((id) => id !== nextParticipantId);
  const completedParticipantIds = error
    ? current.currentRound.completedParticipantIds.filter((id) => id !== nextParticipantId)
    : uniqueIds([...current.currentRound.completedParticipantIds, nextParticipantId]);
  const done = pendingParticipantIds.length === 0;
  const status = done ? (failedParticipantIds.length ? "partial" : "complete") : "running";
  const failureNote = /timeout/i.test(String(error || ""))
    ? "lane timeout"
    : /malformed/i.test(String(error || ""))
      ? "malformed reply"
      : "lane failure";

  const replyMessage = createAgentRoomMessage({
    id: String(messageId || "").trim() || `${nextParticipantId}:${roundId}:${timestamp}`,
    note: error ? failureNote : "council reply",
    participantId: nextParticipantId,
    role: "assistant",
    roundId,
    text: error ? `${nextParticipantId} failed: ${String(error || "Unknown error.").trim()}` : text,
    timestamp
  });

  const nextState = appendAgentRoomMessages(current, [replyMessage], { timestamp });
  return {
    ...nextState,
    currentRound: done
        ? {
          ...current.currentRound,
          attemptsByParticipant,
          completedAt: timestamp,
          completedParticipantIds,
          failedParticipantIds,
          lastErrorByParticipant,
          pendingParticipantIds,
          status
        }
      : {
          ...current.currentRound,
          attemptsByParticipant,
          completedAt: null,
          completedParticipantIds,
          failedParticipantIds,
          lastErrorByParticipant,
          pendingParticipantIds,
          status
        },
    updatedAt: timestamp
  };
}

export function finalizeAgentRoomRound(state, { roundId, timestamp = isoNow() } = {}) {
  const current = normalizeAgentRoomState(state, { timestamp });
  if (!current.currentRound || current.currentRound.id !== String(roundId || "").trim()) {
    return current;
  }

  return {
    ...current,
    currentRound: {
      ...current.currentRound,
      status: current.currentRound.failedParticipantIds.length ? "partial" : "complete"
    },
    updatedAt: timestamp
  };
}

export function interruptAgentRoomRound(
  state,
  { note = "Council round interrupted.", timestamp = isoNow() } = {}
) {
  const current = normalizeAgentRoomState(state, { timestamp });
  if (!current.currentRound) {
    return current;
  }

  const interrupted = appendAgentRoomMessages(current, [
    createAgentRoomMessage({
      id: `system:${current.currentRound.id}:interrupted`,
      note: "council room",
      participantId: "system",
      role: "assistant",
      roundId: current.currentRound.id,
      text: note,
      timestamp
    })
  ], { timestamp });

  return {
    ...interrupted,
    currentRound: null,
    updatedAt: timestamp
  };
}

export function getAgentRoomRetryRound(state) {
  const current = normalizeAgentRoomState(state);
  const round = current.currentRound;
  if (!round || round.status === "running") {
    return null;
  }

  const participantIds = round.failedParticipantIds || [];
  if (!participantIds.length || !round.promptText) {
    return null;
  }

  return {
    note: `council retry / ${participantIds.length} participants`,
    participantIds: [...participantIds],
    promptText: round.promptText,
    retryCount: Number(round.retryCount || 0) + 1,
    roundId: round.id
  };
}
