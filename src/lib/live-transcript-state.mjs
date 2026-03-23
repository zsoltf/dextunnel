export function createLiveTranscriptStateService({
  liveState,
  mapThreadItemToCompanionEntry,
  nowIso = () => new Date().toISOString(),
  getDefaultCwd = () => process.cwd(),
  extractNotificationDelta = (params = {}) => (
    params.delta ??
    params.textDelta ??
    params.outputDelta ??
    params.output ??
    params.chunk ??
    ""
  ),
  visibleTranscriptLimit = 120
} = {}) {
  function mergeThreadSummary(threadId, patch = {}) {
    if (!threadId) {
      return;
    }

    liveState.threads = liveState.threads.map((thread) => (
      thread.id === threadId
        ? {
            ...thread,
            ...patch,
            id: thread.id
          }
        : thread
    ));
  }

  function ensureLiveSelectedSnapshot(threadId, cwd = null) {
    const current = liveState.selectedThreadSnapshot;
    if (current?.thread?.id === threadId) {
      return current;
    }

    const summary = liveState.threads.find((thread) => thread.id === threadId) || null;
    const nextSnapshot = {
      thread: {
        activeTurnId: null,
        activeTurnStatus: null,
        cwd: cwd || summary?.cwd || getDefaultCwd(),
        id: threadId,
        lastTurnId: null,
        lastTurnStatus: null,
        name: summary?.name || null,
        path: null,
        preview: summary?.preview || null,
        source: summary?.source || null,
        status: summary?.status || null,
        updatedAt: summary?.updatedAt || nowIso()
      },
      transcript: [],
      transcriptCount: 0
    };

    liveState.selectedThreadSnapshot = nextSnapshot;
    return nextSnapshot;
  }

  function commitLiveSelectedSnapshot(snapshot) {
    liveState.selectedThreadSnapshot = snapshot;
    liveState.lastSyncAt = nowIso();
    liveState.lastError = null;
  }

  function clampTranscriptEntries(entries) {
    return entries.slice(-visibleTranscriptLimit);
  }

  function upsertTranscriptEntry(snapshot, entry) {
    const transcript = Array.isArray(snapshot?.transcript) ? [...snapshot.transcript] : [];
    const transcriptCountBase = Number.isFinite(snapshot?.transcriptCount)
      ? snapshot.transcriptCount
      : transcript.length;
    const nextEntry = {
      ...entry
    };
    const index = nextEntry.itemId
      ? transcript.findIndex((existing) => existing.itemId && existing.itemId === nextEntry.itemId)
      : -1;

    if (index >= 0) {
      transcript[index] = {
        ...transcript[index],
        ...nextEntry,
        itemId: transcript[index].itemId || nextEntry.itemId || null,
        text: nextEntry.text ?? transcript[index].text,
        timestamp: nextEntry.timestamp || transcript[index].timestamp || null
      };
      return {
        ...snapshot,
        transcript: clampTranscriptEntries(transcript),
        transcriptCount: Math.max(transcriptCountBase, transcript.length)
      };
    }

    transcript.push(nextEntry);
    return {
      ...snapshot,
      transcript: clampTranscriptEntries(transcript),
      transcriptCount: Math.max(transcriptCountBase + 1, transcript.length)
    };
  }

  function updateTranscriptEntryByItemId(snapshot, itemId, updater) {
    if (!itemId) {
      return snapshot;
    }

    const transcript = Array.isArray(snapshot?.transcript) ? [...snapshot.transcript] : [];
    const index = transcript.findIndex((entry) => entry.itemId && entry.itemId === itemId);
    if (index < 0) {
      return snapshot;
    }

    const updated = updater(transcript[index]);
    if (!updated) {
      return snapshot;
    }

    transcript[index] = updated;
    return {
      ...snapshot,
      transcript: clampTranscriptEntries(transcript),
      transcriptCount: Number.isFinite(snapshot?.transcriptCount) ? snapshot.transcriptCount : transcript.length
    };
  }

  function applyTranscriptItemUpdate({ threadId, cwd, turnId, item, timestamp = nowIso() }) {
    if (!threadId || !item) {
      return false;
    }

    const snapshot = ensureLiveSelectedSnapshot(threadId, cwd);
    const nextSnapshot = upsertTranscriptEntry(
      {
        ...snapshot,
        thread: {
          ...snapshot.thread,
          cwd: cwd || snapshot.thread?.cwd || null,
          lastTurnId: turnId || snapshot.thread?.lastTurnId || null,
          updatedAt: timestamp
        }
      },
      mapThreadItemToCompanionEntry(item, {
        id: turnId || snapshot.thread?.lastTurnId || null,
        startedAt: timestamp,
        updatedAt: timestamp
      })
    );

    commitLiveSelectedSnapshot(nextSnapshot);
    return true;
  }

  function appendToTranscriptItem({ threadId, cwd, turnId, itemId, defaults, appendText, timestamp = nowIso() }) {
    if (!threadId || !itemId || !appendText) {
      return false;
    }

    const snapshot = ensureLiveSelectedSnapshot(threadId, cwd);
    const existing = (snapshot.transcript || []).find((entry) => entry.itemId === itemId) || null;
    const baseEntry = existing || {
      itemId,
      kind: defaults.kind,
      phase: defaults.phase || null,
      role: defaults.role,
      text: "",
      timestamp,
      turnId: turnId || snapshot.thread?.lastTurnId || null
    };

    const nextEntry = {
      ...baseEntry,
      ...defaults,
      itemId,
      text: `${baseEntry.text || ""}${appendText}`,
      timestamp,
      turnId: turnId || baseEntry.turnId || null
    };

    const nextSnapshot = upsertTranscriptEntry(
      {
        ...snapshot,
        thread: {
          ...snapshot.thread,
          cwd: cwd || snapshot.thread?.cwd || null,
          lastTurnId: turnId || snapshot.thread?.lastTurnId || null,
          updatedAt: timestamp
        }
      },
      nextEntry
    );

    commitLiveSelectedSnapshot(nextSnapshot);
    return true;
  }

  function appendCommandOutputDelta({ threadId, cwd, turnId, itemId, delta, timestamp = nowIso() }) {
    if (!threadId || !itemId || !delta) {
      return false;
    }

    const snapshot = ensureLiveSelectedSnapshot(threadId, cwd);
    const nextSnapshot = updateTranscriptEntryByItemId(snapshot, itemId, (entry) => {
      const needsSeparator = entry.text && !entry.text.includes("\n");
      return {
        ...entry,
        text: `${entry.text || ""}${needsSeparator ? "\n" : ""}${delta}`,
        timestamp,
        turnId: turnId || entry.turnId || null
      };
    });

    if (nextSnapshot === snapshot) {
      return false;
    }

    commitLiveSelectedSnapshot({
      ...nextSnapshot,
      thread: {
        ...nextSnapshot.thread,
        updatedAt: timestamp
      }
    });
    return true;
  }

  function appendFileChangeOutputDelta({ threadId, cwd, turnId, itemId, delta, timestamp = nowIso() }) {
    if (!threadId || !itemId || !delta) {
      return false;
    }

    const snapshot = ensureLiveSelectedSnapshot(threadId, cwd);
    const nextSnapshot = updateTranscriptEntryByItemId(snapshot, itemId, (entry) => {
      const separator = entry.text && !entry.text.endsWith("\n") ? "\n" : "";
      return {
        ...entry,
        text: `${entry.text || ""}${separator}${delta}`,
        timestamp,
        turnId: turnId || entry.turnId || null
      };
    });

    if (nextSnapshot === snapshot) {
      return false;
    }

    commitLiveSelectedSnapshot({
      ...nextSnapshot,
      thread: {
        ...nextSnapshot.thread,
        updatedAt: timestamp
      }
    });
    return true;
  }

  function applyTurnPlanUpdate({ threadId, cwd, turnId, explanation = null, plan = null, timestamp = nowIso() }) {
    if (!threadId) {
      return false;
    }

    const snapshot = ensureLiveSelectedSnapshot(threadId, cwd);
    const nextThread = {
      ...snapshot.thread,
      cwd: cwd || snapshot.thread?.cwd || null,
      lastTurnId: turnId || snapshot.thread?.lastTurnId || null,
      livePlan: Array.isArray(plan) ? plan : snapshot.thread?.livePlan || null,
      planExplanation: explanation ?? snapshot.thread?.planExplanation ?? null,
      updatedAt: timestamp
    };

    commitLiveSelectedSnapshot({
      ...snapshot,
      thread: nextThread
    });
    return true;
  }

  function applyThreadTokenUsageUpdate({ threadId, cwd, tokenUsage, timestamp = nowIso() }) {
    if (!threadId || !tokenUsage) {
      return false;
    }

    const snapshot = ensureLiveSelectedSnapshot(threadId, cwd);
    commitLiveSelectedSnapshot({
      ...snapshot,
      thread: {
        ...snapshot.thread,
        cwd: cwd || snapshot.thread?.cwd || null,
        tokenUsage,
        updatedAt: timestamp
      }
    });
    return true;
  }

  function applyTurnLifecycleUpdate({ threadId, cwd, turn, timestamp = nowIso() }) {
    if (!threadId) {
      return false;
    }

    const snapshot = ensureLiveSelectedSnapshot(threadId, cwd);
    const status = turn?.status || null;
    const nextThread = {
      ...snapshot.thread,
      activeTurnId: status === "inProgress" ? turn?.id || snapshot.thread?.activeTurnId || null : null,
      activeTurnStatus: status === "inProgress" ? status : null,
      cwd: cwd || turn?.cwd || snapshot.thread?.cwd || null,
      id: threadId,
      lastTurnId: turn?.id || snapshot.thread?.lastTurnId || null,
      lastTurnStatus: status || snapshot.thread?.lastTurnStatus || null,
      status: status === "inProgress" ? "inProgress" : snapshot.thread?.status || null,
      updatedAt: turn?.updatedAt || turn?.startedAt || timestamp
    };

    if (status && status !== "inProgress") {
      nextThread.status = status;
    }

    commitLiveSelectedSnapshot({
      ...snapshot,
      thread: nextThread
    });
    mergeThreadSummary(threadId, {
      cwd: nextThread.cwd,
      status: nextThread.status,
      updatedAt: nextThread.updatedAt
    });
    return true;
  }

  function applyThreadNameUpdate({ threadId, cwd, name, timestamp = nowIso() }) {
    if (!threadId || !name) {
      return false;
    }

    const snapshot = ensureLiveSelectedSnapshot(threadId, cwd);
    commitLiveSelectedSnapshot({
      ...snapshot,
      thread: {
        ...snapshot.thread,
        name,
        updatedAt: timestamp
      }
    });
    mergeThreadSummary(threadId, {
      name,
      updatedAt: timestamp
    });
    return true;
  }

  function applyThreadStatusUpdate({ threadId, cwd, status, timestamp = nowIso() }) {
    if (!threadId) {
      return false;
    }

    const snapshot = ensureLiveSelectedSnapshot(threadId, cwd);
    commitLiveSelectedSnapshot({
      ...snapshot,
      thread: {
        ...snapshot.thread,
        status: status || snapshot.thread?.status || null,
        updatedAt: timestamp
      }
    });
    mergeThreadSummary(threadId, {
      status: status || null,
      updatedAt: timestamp
    });
    return true;
  }

  function applyWatcherNotification(message, { threadId, cwd }) {
    const params = message.params || {};
    const eventThreadId = params.threadId || threadId;
    const eventTurnId = params.turnId || params.turn?.id || null;
    const timestamp = nowIso();

    if (eventThreadId !== liveState.selectedThreadId) {
      return false;
    }

    switch (message.method) {
      case "turn/started":
        return applyTurnLifecycleUpdate({
          cwd,
          threadId: eventThreadId,
          timestamp,
          turn: params.turn || { id: eventTurnId, status: "inProgress" }
        });
      case "turn/completed":
        return applyTurnLifecycleUpdate({
          cwd,
          threadId: eventThreadId,
          timestamp,
          turn: params.turn || { id: eventTurnId, status: "completed" }
        });
      case "item/started":
      case "item/completed":
        return applyTranscriptItemUpdate({
          cwd,
          item: params.item,
          threadId: eventThreadId,
          timestamp,
          turnId: eventTurnId
        });
      case "item/agentMessage/delta":
        return appendToTranscriptItem({
          appendText: extractNotificationDelta(params),
          cwd,
          defaults: {
            kind: "message",
            phase: null,
            role: "assistant"
          },
          itemId: params.itemId || null,
          threadId: eventThreadId,
          timestamp,
          turnId: eventTurnId
        });
      case "item/plan/delta":
        return appendToTranscriptItem({
          appendText: extractNotificationDelta(params),
          cwd,
          defaults: {
            kind: "plan",
            phase: null,
            role: "system"
          },
          itemId: params.itemId || null,
          threadId: eventThreadId,
          timestamp,
          turnId: eventTurnId
        });
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        return appendToTranscriptItem({
          appendText: extractNotificationDelta(params),
          cwd,
          defaults: {
            kind: "reasoning",
            phase: null,
            role: "system"
          },
          itemId: params.itemId || null,
          threadId: eventThreadId,
          timestamp,
          turnId: eventTurnId
        });
      case "item/reasoning/summaryPartAdded":
        return appendToTranscriptItem({
          appendText: "\n\n",
          cwd,
          defaults: {
            kind: "reasoning",
            phase: null,
            role: "system"
          },
          itemId: params.itemId || null,
          threadId: eventThreadId,
          timestamp,
          turnId: eventTurnId
        });
      case "item/commandExecution/outputDelta":
        return appendCommandOutputDelta({
          cwd,
          delta: extractNotificationDelta(params),
          itemId: params.itemId || null,
          threadId: eventThreadId,
          timestamp,
          turnId: eventTurnId
        });
      case "item/fileChange/outputDelta":
        return appendFileChangeOutputDelta({
          cwd,
          delta: extractNotificationDelta(params),
          itemId: params.itemId || null,
          threadId: eventThreadId,
          timestamp,
          turnId: eventTurnId
        });
      case "turn/plan/updated":
        return applyTurnPlanUpdate({
          cwd,
          explanation: params.explanation || null,
          plan: params.plan || null,
          threadId: eventThreadId,
          timestamp,
          turnId: eventTurnId
        });
      case "thread/tokenUsage/updated":
        return applyThreadTokenUsageUpdate({
          cwd,
          threadId: eventThreadId,
          timestamp,
          tokenUsage: params.tokenUsage || params.usage || params.thread?.tokenUsage || null
        });
      case "thread/compacted":
        return applyTranscriptItemUpdate({
          cwd,
          item: {
            id: params.itemId || `thread-compacted-${eventTurnId || timestamp}`,
            type: "contextCompaction"
          },
          threadId: eventThreadId,
          timestamp,
          turnId: eventTurnId
        });
      case "thread/name/updated":
        return applyThreadNameUpdate({
          cwd,
          name: params.name || params.thread?.name || null,
          threadId: eventThreadId,
          timestamp
        });
      case "thread/status/changed":
        return applyThreadStatusUpdate({
          cwd,
          status: params.status || params.thread?.status || null,
          threadId: eventThreadId,
          timestamp
        });
      default:
        return false;
    }
  }

  return {
    appendCommandOutputDelta,
    appendFileChangeOutputDelta,
    appendToTranscriptItem,
    applyThreadNameUpdate,
    applyThreadStatusUpdate,
    applyThreadTokenUsageUpdate,
    applyTranscriptItemUpdate,
    applyTurnLifecycleUpdate,
    applyTurnPlanUpdate,
    applyWatcherNotification,
    commitLiveSelectedSnapshot,
    ensureLiveSelectedSnapshot,
    mergeThreadSummary,
    upsertTranscriptEntry
  };
}
