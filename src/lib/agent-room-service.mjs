export function createAgentRoomService({
  buildParticipant,
  broadcast = () => {},
  codexAppServer,
  defaultAgentRoomState,
  getBuildAgentRoomContextMarkdown = () => (() => ""),
  getLivePayload = () => ({}),
  getAgentRoomRetryRound,
  interruptAgentRoomRound,
  liveState,
  mapThreadToCompanionSnapshot,
  normalizeAgentRoomState,
  nowIso = () => new Date().toISOString(),
  persistState = async () => {},
  randomId = () => `${Date.now()}`,
  runtime,
  setAgentRoomEnabled,
  settleAgentRoomParticipant,
  startAgentRoomRound,
  store
} = {}) {
  function getThreadAgentRoomState(threadId) {
    const id = String(threadId || "").trim();
    if (!id) {
      return defaultAgentRoomState();
    }

    return liveState.agentRoomByThreadId[id] || defaultAgentRoomState({ threadId: id });
  }

  function setThreadAgentRoomState(threadId, state) {
    const id = String(threadId || "").trim();
    if (!id) {
      return defaultAgentRoomState();
    }

    const nextState = normalizeAgentRoomState(state, { threadId: id });
    liveState.agentRoomByThreadId = {
      ...liveState.agentRoomByThreadId,
      [id]: nextState
    };
    return nextState;
  }

  async function loadThreadAgentRoomState(threadId) {
    const id = String(threadId || "").trim();
    if (!id) {
      return defaultAgentRoomState();
    }

    const existing = liveState.agentRoomByThreadId[id];
    if (existing) {
      return existing;
    }

    const loaded = await store.load(id);
    const nextState = setThreadAgentRoomState(id, loaded);
    await persistState(id, nextState);
    return nextState;
  }

  async function persistThreadAgentRoomState(threadId, state = null) {
    const id = String(threadId || "").trim();
    if (!id) {
      return;
    }

    await persistState(id, state || getThreadAgentRoomState(id));
  }

  function agentRoomMemberParticipant(participantId, state = null) {
    const activeRound = state?.currentRound || null;
    const pending = activeRound?.pendingParticipantIds?.includes(participantId);
    const completed = activeRound?.completedParticipantIds?.includes(participantId);
    const failed = activeRound?.failedParticipantIds?.includes(participantId);
    const metaLabel = pending ? "thinking" : failed ? "failed" : completed ? "replied" : "room";
    return buildParticipant(participantId, {
      metaLabel,
      state: pending ? "ready" : failed ? "dormant" : completed ? "ready" : "dormant"
    });
  }

  function buildSelectedAgentRoomState(threadId = liveState.selectedThreadId || null) {
    const id = String(threadId || "").trim();
    const state = getThreadAgentRoomState(id);
    const messages = state.messages
      .map((message) => ({
        ...message,
        kind:
          String(message.note || "").startsWith("lane ") || message.note === "malformed reply"
            ? "commentary"
            : "message",
        lane: message.lane || message.participantId,
        origin: message.origin || message.participantId,
        participant: agentRoomMemberParticipant(message.participantId, state)
      }))
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

    return {
      enabled: Boolean(state.enabled),
      memberIds: [...state.memberIds],
      messages,
      participants: state.memberIds.map((participantId) => agentRoomMemberParticipant(participantId, state)),
      round:
        state.currentRound
          ? {
              ...state.currentRound,
              canRetryFailed:
                state.currentRound.status !== "running" &&
                Boolean(state.currentRound.promptText) &&
                state.currentRound.failedParticipantIds.length > 0,
              completedCount: state.currentRound.completedParticipantIds.length,
              failedCount: state.currentRound.failedParticipantIds.length,
              pendingCount: state.currentRound.pendingParticipantIds.length
            }
          : null,
      threadId: state.threadId,
      updatedAt: state.updatedAt || null
    };
  }

  async function loadThreadSnapshot(threadId) {
    let snapshot =
      liveState.selectedThreadSnapshot?.thread?.id === threadId
        ? liveState.selectedThreadSnapshot
        : null;
    if (!snapshot) {
      try {
        const thread = await codexAppServer.readThread(threadId, true);
        snapshot = thread ? mapThreadToCompanionSnapshot(thread, { limit: 60 }) : null;
      } catch {}
    }
    return snapshot;
  }

  async function settleRoundParticipant({ participantId, roundId, text = "", threadId, timestamp, error = null }) {
    const refreshed = await loadThreadAgentRoomState(threadId);
    if (!refreshed.enabled || refreshed.currentRound?.id !== roundId) {
      return;
    }
    const nextState = setThreadAgentRoomState(
      threadId,
      settleAgentRoomParticipant(refreshed, {
        error,
        messageId: randomId(),
        participantId,
        roundId,
        text,
        timestamp
      })
    );
    await persistThreadAgentRoomState(threadId, nextState);
    broadcast("live", getLivePayload());
  }

  async function runAgentRoomRound({ promptText, roundId, threadId } = {}) {
    const initialState = await loadThreadAgentRoomState(threadId);
    if (!initialState.enabled || initialState.currentRound?.id !== roundId) {
      return;
    }

    const snapshot = await loadThreadSnapshot(threadId);
    const buildAgentRoomContextMarkdown = getBuildAgentRoomContextMarkdown();
    const prepared = await runtime.prepareRound({
      contextMarkdown: buildAgentRoomContextMarkdown({
        roomState: initialState,
        snapshot,
        threadId
      }),
      roundId,
      threadId
    });

    for (const participantId of initialState.currentRound.participantIds) {
      const current = await loadThreadAgentRoomState(threadId);
      if (!current.enabled || current.currentRound?.id !== roundId) {
        return;
      }

      await persistState(prepared.contextFile, buildAgentRoomContextMarkdown({
        roomState: current,
        snapshot,
        threadId
      }), { raw: true });

      try {
        const text = await runtime.runParticipant({
          contextFile: prepared.contextFile,
          participantId,
          promptText,
          roundDir: prepared.roundDir
        });
        await settleRoundParticipant({
          participantId,
          roundId,
          text,
          threadId,
          timestamp: nowIso()
        });
      } catch (error) {
        await settleRoundParticipant({
          error: error.message,
          participantId,
          roundId,
          text: "",
          threadId,
          timestamp: nowIso()
        });
      }
    }
  }

  async function updateAgentRoom({ action = "", memberIds = null, text = "", threadId = null } = {}) {
    const id = String(threadId || liveState.selectedThreadId || "").trim();
    if (!id) {
      throw new Error("Select a live session before using the council room.");
    }

    const current = await loadThreadAgentRoomState(id);
    if (action === "enable") {
      const nextState = setThreadAgentRoomState(id, setAgentRoomEnabled(current, true, {
        memberIds,
        timestamp: nowIso()
      }));
      await persistThreadAgentRoomState(id, nextState);
      return {
        message: "Council room enabled.",
        state: nextState
      };
    }

    if (action === "disable") {
      const nextState = setThreadAgentRoomState(
        id,
        setAgentRoomEnabled(
          current.currentRound
            ? interruptAgentRoomRound(current, {
                note: "Council room disabled. Active discussion stopped.",
                timestamp: nowIso()
              })
            : current,
          false,
          {
            timestamp: nowIso()
          }
        )
      );
      await persistThreadAgentRoomState(id, nextState);
      return {
        message: "Council room disabled.",
        state: nextState
      };
    }

    if (action === "send") {
      const promptText = String(text || "").trim();
      if (!current.enabled) {
        throw new Error("Enable the council room before sending to it.");
      }
      if (!promptText) {
        throw new Error("Council room messages cannot be empty.");
      }
      const roundId = randomId();
      const nextState = setThreadAgentRoomState(
        id,
        startAgentRoomRound(current, {
          messageId: randomId(),
          participantIds: current.memberIds,
          roundId,
          text: promptText,
          timestamp: nowIso()
        })
      );
      await persistThreadAgentRoomState(id, nextState);
      void runAgentRoomRound({
        promptText,
        roundId,
        threadId: id
      });
      return {
        message: "Council round started.",
        state: nextState
      };
    }

    if (action === "retry") {
      if (!current.enabled) {
        throw new Error("Enable the council room before retrying it.");
      }

      const retry = getAgentRoomRetryRound(current);
      if (!retry) {
        throw new Error("There is no failed council round ready to retry.");
      }

      const roundId = randomId();
      const nextState = setThreadAgentRoomState(
        id,
        startAgentRoomRound(current, {
          messageId: randomId(),
          note: retry.note,
          participantIds: retry.participantIds,
          promptText: retry.promptText,
          retryCount: retry.retryCount,
          roundId,
          text: retry.promptText,
          timestamp: nowIso()
        })
      );
      await persistThreadAgentRoomState(id, nextState);
      void runAgentRoomRound({
        promptText: retry.promptText,
        roundId,
        threadId: id
      });
      return {
        message: "Retrying failed council participants.",
        state: nextState
      };
    }

    throw new Error(`Unsupported council room action: ${action}`);
  }

  return {
    agentRoomMemberParticipant,
    buildSelectedAgentRoomState,
    getThreadAgentRoomState,
    loadThreadAgentRoomState,
    persistThreadAgentRoomState,
    runAgentRoomRound,
    setThreadAgentRoomState,
    updateAgentRoom
  };
}
