function isOriginEligibleEntry(entry) {
  if (!entry) {
    return false;
  }

  if (entry.role === "user") {
    return true;
  }

  return entry.role === "assistant" && entry.kind !== "commentary";
}

export function createLivePayloadBuilder(deps) {
  const {
    advisoryParticipantForThread,
    ADVISORY_PARTICIPANT_IDS = [],
    bestConversationLabel,
    bestThreadLabel,
    buildBridgeStatus,
    buildParticipant,
    buildSelectedAgentRoomState,
    buildSelectedAttachments,
    buildSelectedCompanionState,
    getPendingInteractionForSelectedThread,
    liveState,
    looksLikeTopicNoise,
    normalizeLane,
    projectLabel,
    pruneAllCompanionWakeups,
    pruneStaleSurfacePresence,
    repoObjective,
    selectedThreadSummary,
    slugifyChannelName,
    summarizeThread,
    trimTopicText
  } = deps;

  function inferEntryLane(entry, thread) {
    const explicitLane = normalizeLane(entry?.origin);
    if (explicitLane) {
      return explicitLane;
    }

    if (entry?.role !== "user") {
      return "";
    }

    if (thread?.source === "vscode") {
      return "desktop";
    }

    if (thread?.source === "cli") {
      return "external";
    }

    return "";
  }

  function participantForEntry(entry, thread) {
    const lane = inferEntryLane(entry, thread);

    if (entry?.kind === "pending" || entry?.kind === "queued") {
      return buildParticipant("remote");
    }

    if (entry?.role === "assistant" && entry?.kind === "commentary") {
      return buildParticipant("updates");
    }

    if (entry?.role === "assistant") {
      return buildParticipant("codex");
    }

    if (entry?.role === "user") {
      if (lane === "remote") {
        return buildParticipant("remote");
      }

      if (lane === "desktop") {
        return buildParticipant("desktop");
      }

      if (lane === "oracle") {
        return buildParticipant("oracle");
      }

      if (lane === "gemini") {
        return buildParticipant("gemini");
      }

      if (lane === "external") {
        return buildParticipant("user", {
          label: "external",
          lane: "external",
          token: "user"
        });
      }

      return buildParticipant("user");
    }

    if (entry?.role === "tool") {
      return buildParticipant("tools");
    }

    return buildParticipant("system");
  }

  function buildChannelTopic(snapshot) {
    const thread = snapshot?.thread || null;
    const objective = repoObjective(thread?.cwd || "");
    if (objective && !looksLikeTopicNoise(objective)) {
      return objective;
    }

    if (thread?.preview && !looksLikeTopicNoise(thread.preview)) {
      return trimTopicText(thread.preview);
    }

    const latestConversation = bestConversationLabel(snapshot, 120);
    if (!latestConversation) {
      return "";
    }

    return trimTopicText(latestConversation, 120);
  }

  function buildSelectedChannel(snapshot) {
    const thread = snapshot?.thread || selectedThreadSummary() || null;
    const cwd = thread?.cwd || liveState.selectedProjectCwd || process.cwd();
    const label = bestThreadLabel(
      {
        ...thread,
        cwd
      },
      snapshot,
      { selected: true }
    );

    return {
      channelId: thread?.id || liveState.selectedThreadId || null,
      channelLabel: label,
      channelSlug: `#${slugifyChannelName(label)}`,
      source: thread?.source || null,
      serverId: cwd,
      serverLabel: projectLabel(cwd),
      topic: buildChannelTopic(snapshot)
    };
  }

  function buildParticipants(snapshot) {
    const participants = new Map();
    const threadId = snapshot?.thread?.id || null;

    for (const entry of snapshot?.transcript || []) {
      const participant = participantForEntry(entry, snapshot?.thread);
      participants.set(participant.id, participant);
    }

    if (snapshot?.thread?.source === "vscode" && !participants.has("desktop")) {
      participants.set("desktop", buildParticipant("desktop"));
    }

    if (!participants.has("remote")) {
      participants.set("remote", buildParticipant("remote"));
    }

    if (!participants.has("codex")) {
      participants.set("codex", buildParticipant("codex"));
    }

    for (const advisorId of ADVISORY_PARTICIPANT_IDS) {
      participants.set(advisorId, advisoryParticipantForThread(advisorId, threadId));
    }

    return [...participants.values()].sort((a, b) => {
      const orderDelta = (a.sortOrder || 999) - (b.sortOrder || 999);
      if (orderDelta !== 0) {
        return orderDelta;
      }

      return String(a.label || a.id || "").localeCompare(String(b.label || b.id || ""));
    });
  }

  function applyTurnOrigins(snapshot) {
    const threadId = snapshot?.thread?.id || null;
    if (!threadId || !Array.isArray(snapshot?.transcript) || snapshot.transcript.length === 0) {
      return snapshot;
    }

    const turnOrigins = liveState.turnOriginsByThreadId?.[threadId];
    if (!turnOrigins) {
      return snapshot;
    }

    let changed = false;
    const transcript = snapshot.transcript.map((entry) => {
      const origin =
        isOriginEligibleEntry(entry) && entry.turnId
          ? turnOrigins[entry.turnId] || null
          : null;
      const currentOrigin = entry.origin || null;

      if (currentOrigin === origin) {
        return entry;
      }

      changed = true;
      if (!origin) {
        const { origin: _origin, ...rest } = entry;
        return rest;
      }

      return {
        ...entry,
        origin
      };
    });

    if (!changed) {
      return snapshot;
    }

    return {
      ...snapshot,
      transcript
    };
  }

  function decorateSnapshot(snapshot) {
    const withOrigins = applyTurnOrigins(snapshot);
    const thread = withOrigins?.thread || null;

    if (!thread || !Array.isArray(withOrigins?.transcript)) {
      return withOrigins;
    }

    const transcript = withOrigins.transcript.map((entry) => {
      const lane = inferEntryLane(entry, thread);
      const participant = participantForEntry(entry, thread);

      return {
        ...entry,
        lane,
        participant
      };
    });

    const nextSnapshot = {
      ...withOrigins,
      transcript
    };

    return {
      ...nextSnapshot,
      channel: buildSelectedChannel(nextSnapshot),
      participants: buildParticipants(nextSnapshot)
    };
  }

  function buildLivePayload() {
    pruneStaleSurfacePresence();
    pruneAllCompanionWakeups();
    const selectedThreadSnapshot = decorateSnapshot(liveState.selectedThreadSnapshot);
    const selectedThreadId = selectedThreadSnapshot?.thread?.id || liveState.selectedThreadId || null;
    const selectedAttachments = buildSelectedAttachments(selectedThreadId);
    const selectedCompanion = buildSelectedCompanionState(selectedThreadId);
    const selectedAgentRoom = buildSelectedAgentRoomState(selectedThreadId);

    return {
      pendingInteraction: getPendingInteractionForSelectedThread(),
      participants: selectedThreadSnapshot?.participants || [],
      selectedAgentRoom,
      selectedCompanion,
      selectedAttachments,
      selectedChannel: selectedThreadSnapshot?.channel || buildSelectedChannel(null),
      selectedProjectCwd: liveState.selectedProjectCwd,
      selectionSource: liveState.selectionSource,
      selectedThreadId: liveState.selectedThreadId,
      selectedThreadSnapshot,
      status: buildBridgeStatus(),
      turnDiff: liveState.turnDiff,
      threads: liveState.threads.map(summarizeThread)
    };
  }

  return {
    applyTurnOrigins,
    buildChannelTopic,
    buildLivePayload,
    buildParticipants,
    buildSelectedChannel,
    decorateSnapshot,
    inferEntryLane,
    participantForEntry
  };
}
