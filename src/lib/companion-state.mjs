export function createCompanionStateService({
  ADVISORY_PARTICIPANT_IDS = [],
  COMPANION_WAKEUP_LIMIT,
  COMPANION_WAKEUP_SNOOZE_MS,
  COMPANION_WAKEUP_STALE_MS,
  COMPANION_WAKEUP_VISIBLE_MS,
  buildParticipant,
  liveState,
  nowIso
}) {
  function defaultAdvisoryState(id) {
    return {
      id,
      lastWakeAt: null,
      metaLabel: "dormant",
      state: "dormant",
      wakeKey: null,
      wakeKind: null
    };
  }

  function advisoryMetaLabel(state, wakeKind = null) {
    if (state === "ready") {
      return wakeKind === "summary" ? "summary ready" : "review ready";
    }

    return "dormant";
  }

  function isCompanionWakeupVisible(notice) {
    return notice?.status === "ready";
  }

  function normalizeCompanionThreadState(state, { now = Date.now() } = {}) {
    const baseState = state || {
      advisories: Object.fromEntries(ADVISORY_PARTICIPANT_IDS.map((advisorId) => [advisorId, defaultAdvisoryState(advisorId)])),
      wakeups: []
    };
    const currentWakeups = Array.isArray(baseState.wakeups) ? baseState.wakeups : [];
    let changed = !Array.isArray(baseState.wakeups);
    const nextWakeups = [];

    for (const rawNotice of currentWakeups) {
      const advisorId = ADVISORY_PARTICIPANT_IDS.includes(rawNotice?.advisorId) ? rawNotice.advisorId : null;
      const key = String(rawNotice?.key || "").trim();
      const atMs = new Date(rawNotice?.timestamp || 0).getTime();
      if (!advisorId || !key || !atMs || now - atMs > COMPANION_WAKEUP_STALE_MS) {
        changed = true;
        continue;
      }

      let nextNotice = {
        ...rawNotice,
        advisorId,
        key,
        status: rawNotice?.status || "ready"
      };

      if (nextNotice.status === "snoozed") {
        const snoozeUntilMs = new Date(nextNotice.snoozeUntil || 0).getTime();
        if (!snoozeUntilMs || now >= snoozeUntilMs) {
          nextNotice = {
            ...nextNotice,
            snoozeUntil: null,
            status: "ready",
            timestamp: nowIso()
          };
          changed = true;
        }
      }

      const visibleAtMs = new Date(nextNotice.timestamp || 0).getTime();
      if (nextNotice.status === "ready" && visibleAtMs && now - visibleAtMs > COMPANION_WAKEUP_VISIBLE_MS) {
        nextNotice = {
          ...nextNotice,
          expiredAt: nextNotice.expiredAt || nowIso(),
          status: "expired"
        };
        changed = true;
      }

      nextWakeups.push(nextNotice);
    }

    nextWakeups.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    if (nextWakeups.length > COMPANION_WAKEUP_LIMIT) {
      changed = true;
    }

    const limitedWakeups = nextWakeups.slice(0, COMPANION_WAKEUP_LIMIT);
    const nextAdvisories = {};
    for (const advisorId of ADVISORY_PARTICIPANT_IDS) {
      const current = baseState.advisories?.[advisorId] || defaultAdvisoryState(advisorId);
      const readyWakeup = limitedWakeups.find((notice) => notice.advisorId === advisorId && isCompanionWakeupVisible(notice));
      if (readyWakeup) {
        nextAdvisories[advisorId] = {
          ...current,
          lastWakeAt: readyWakeup.timestamp,
          metaLabel: advisoryMetaLabel("ready", readyWakeup.wakeKind),
          state: "ready",
          wakeKey: readyWakeup.key,
          wakeKind: readyWakeup.wakeKind || null
        };
        continue;
      }

      nextAdvisories[advisorId] = {
        ...current,
        metaLabel: "dormant",
        state: "dormant",
        wakeKey: null,
        wakeKind: null
      };
    }

    const nextState = {
      advisories: nextAdvisories,
      wakeups: limitedWakeups
    };

    if (!changed) {
      changed = JSON.stringify({
        advisories: baseState.advisories || {},
        wakeups: currentWakeups
      }) !== JSON.stringify(nextState);
    }

    return {
      changed,
      nextState
    };
  }

  function ensureThreadCompanionState(threadId) {
    const id = String(threadId || "").trim();
    if (!id) {
      return {
        advisories: Object.fromEntries(ADVISORY_PARTICIPANT_IDS.map((advisorId) => [advisorId, defaultAdvisoryState(advisorId)])),
        wakeups: []
      };
    }

    const existing = liveState.companionByThreadId[id];
    if (existing) {
      for (const advisorId of ADVISORY_PARTICIPANT_IDS) {
        if (!existing.advisories[advisorId]) {
          existing.advisories[advisorId] = defaultAdvisoryState(advisorId);
        }
      }
      existing.wakeups = Array.isArray(existing.wakeups) ? existing.wakeups : [];
      return existing;
    }

    const created = {
      advisories: Object.fromEntries(ADVISORY_PARTICIPANT_IDS.map((advisorId) => [advisorId, defaultAdvisoryState(advisorId)])),
      wakeups: []
    };
    liveState.companionByThreadId = {
      ...liveState.companionByThreadId,
      [id]: created
    };
    return created;
  }

  function setThreadCompanionState(threadId, state) {
    const id = String(threadId || "").trim();
    if (!id) {
      return;
    }

    liveState.companionByThreadId = {
      ...liveState.companionByThreadId,
      [id]: state
    };
  }

  function pruneCompanionWakeupsForThread(threadId, { now = Date.now() } = {}) {
    const id = String(threadId || "").trim();
    if (!id) {
      return false;
    }

    const state = liveState.companionByThreadId[id];
    if (!state) {
      return false;
    }

    const { changed, nextState } = normalizeCompanionThreadState(state, { now });
    if (changed) {
      setThreadCompanionState(id, nextState);
    }

    return changed;
  }

  function pruneAllCompanionWakeups({ now = Date.now() } = {}) {
    let changed = false;
    for (const threadId of Object.keys(liveState.companionByThreadId || {})) {
      if (pruneCompanionWakeupsForThread(threadId, { now })) {
        changed = true;
      }
    }
    return changed;
  }

  function resetCompanionWakeups(threadId, { preserveLastWake = true } = {}) {
    const id = String(threadId || "").trim();
    if (!id) {
      return false;
    }

    const state = ensureThreadCompanionState(id);
    const hadWakeups = Boolean(state.wakeups.length);
    let changed = hadWakeups;
    const advisories = { ...state.advisories };

    for (const advisorId of ADVISORY_PARTICIPANT_IDS) {
      const current = advisories[advisorId] || defaultAdvisoryState(advisorId);
      if (current.state !== "dormant" || current.metaLabel !== "dormant" || current.wakeKey || current.wakeKind) {
        advisories[advisorId] = {
          ...current,
          metaLabel: "dormant",
          state: "dormant",
          wakeKey: null,
          wakeKind: null,
          ...(preserveLastWake ? {} : { lastWakeAt: null })
        };
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    setThreadCompanionState(id, {
      advisories,
      wakeups: []
    });
    return true;
  }

  function queueCompanionWakeup({
    allowDuringPending = false,
    advisorId,
    text,
    threadId,
    timestamp = nowIso(),
    turnId = null,
    wakeKey,
    wakeKind = "review"
  } = {}) {
    const id = String(threadId || "").trim();
    const advisor = ADVISORY_PARTICIPANT_IDS.includes(advisorId) ? advisorId : null;
    const body = String(text || "").trim();
    const key = String(wakeKey || "").trim();
    if (!id || !advisor || !body || !key) {
      return false;
    }

    const pending = liveState.pendingInteraction || null;
    if (!allowDuringPending && pending?.threadId && pending.threadId === id) {
      return false;
    }

    pruneCompanionWakeupsForThread(id);
    const state = ensureThreadCompanionState(id);
    const existing = state.wakeups.find((notice) => notice.key === key);
    if (existing) {
      return false;
    }

    const nextWakeups = [
      {
        advisorId: advisor,
        id: `companion-${advisor}-${turnId || Date.now()}`,
        key,
        kind: "commentary",
        note: "advisory wakeup",
        role: "assistant",
        status: "ready",
        text: body,
        timestamp,
        turnId,
        wakeKind
      },
      ...state.wakeups.filter((notice) => notice.advisorId !== advisor)
    ];
    const { nextState } = normalizeCompanionThreadState({
      advisories: {
        ...state.advisories
      },
      wakeups: nextWakeups
    });
    setThreadCompanionState(id, nextState);
    return true;
  }

  function companionActionMessage({ action, advisorId, snoozeUntil = null } = {}) {
    const advisorLabel = advisorId === "gemini" ? "Gemini" : advisorId === "oracle" ? "Oracle" : "Advisor";
    if (action === "summon") {
      return advisorId === "oracle" ? "Oracle review ready." : "Gemini recap ready.";
    }
    if (action === "snooze") {
      return `${advisorLabel} reminder snoozed until ${new Date(snoozeUntil || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
    }

    return `${advisorLabel} reminder dismissed.`;
  }

  function summonCompanionWakeup({ advisorId = "", threadId = null } = {}) {
    const nextThreadId = threadId || liveState.selectedThreadId || liveState.selectedThreadSnapshot?.thread?.id || null;
    if (!nextThreadId) {
      throw new Error("Select a live session before waking an advisor.");
    }

    const normalizedAdvisorId = String(advisorId || "").trim().toLowerCase();
    if (!ADVISORY_PARTICIPANT_IDS.includes(normalizedAdvisorId)) {
      throw new Error(`Unsupported advisor: ${advisorId}`);
    }

    const wakeKind = normalizedAdvisorId === "oracle" ? "review" : "summary";
    const queued = queueCompanionWakeup({
      advisorId: normalizedAdvisorId,
      allowDuringPending: true,
      text:
        wakeKind === "review"
          ? "Review ready: Oracle can stage a quick risk review draft for this channel."
          : "Summary ready: Gemini can stage a quick recap draft for this channel.",
      threadId: nextThreadId,
      turnId: null,
      wakeKey: `manual-${normalizedAdvisorId}:${Date.now()}`,
      wakeKind
    });

    if (!queued) {
      throw new Error("Could not stage the advisor wakeup.");
    }

    return {
      action: "summon",
      advisorId: normalizedAdvisorId,
      message: companionActionMessage({ action: "summon", advisorId: normalizedAdvisorId }),
      wakeKind
    };
  }

  function applyCompanionWakeupAction({ action, threadId, wakeKey } = {}) {
    const id = String(threadId || "").trim();
    const key = String(wakeKey || "").trim();
    if (!id || !key) {
      throw new Error("A live advisory notice is required.");
    }

    const normalizedAction = action === "snooze" ? "snooze" : action === "dismiss" ? "dismiss" : "";
    if (!normalizedAction) {
      throw new Error(`Unsupported companion action: ${action}`);
    }

    pruneCompanionWakeupsForThread(id);
    const state = ensureThreadCompanionState(id);
    const existing = state.wakeups.find((notice) => notice.key === key);
    if (!existing || !isCompanionWakeupVisible(existing)) {
      throw new Error("That advisory notice is no longer active.");
    }

    const nextWakeup =
      normalizedAction === "snooze"
        ? {
            ...existing,
            snoozeUntil: new Date(Date.now() + COMPANION_WAKEUP_SNOOZE_MS).toISOString(),
            status: "snoozed"
          }
        : {
            ...existing,
            dismissedAt: nowIso(),
            snoozeUntil: null,
            status: "dismissed"
          };

    const nextWakeups = state.wakeups.map((notice) => (notice.key === key ? nextWakeup : notice));
    const { nextState } = normalizeCompanionThreadState({
      advisories: {
        ...state.advisories
      },
      wakeups: nextWakeups
    });
    setThreadCompanionState(id, nextState);

    return {
      action: normalizedAction,
      advisorId: existing.advisorId,
      message: companionActionMessage({
        action: normalizedAction,
        advisorId: existing.advisorId,
        snoozeUntil: nextWakeup.snoozeUntil || null
      }),
      snoozeUntil: nextWakeup.snoozeUntil || null
    };
  }

  function buildSelectedCompanionState(threadId = liveState.selectedThreadId || null) {
    const id = String(threadId || "").trim();
    if (!id) {
      return {
        advisories: ADVISORY_PARTICIPANT_IDS.map((advisorId) => defaultAdvisoryState(advisorId)),
        wakeups: []
      };
    }

    pruneCompanionWakeupsForThread(id);
    const state = liveState.companionByThreadId[id] || ensureThreadCompanionState(id);
    const visibleWakeups = (state.wakeups || []).filter((notice) => isCompanionWakeupVisible(notice));
    return {
      advisories: ADVISORY_PARTICIPANT_IDS.map((advisorId) => ({
        ...(state.advisories[advisorId] || defaultAdvisoryState(advisorId)),
        id: advisorId,
        label: advisorId
      })),
      wakeups: visibleWakeups.map((notice) => ({
        ...notice,
        actions: [
          { action: "snooze", busyLabel: "Later...", label: "Later" },
          { action: "dismiss", busyLabel: "Dismissing...", label: "Dismiss" }
        ],
        lane: notice.advisorId,
        origin: notice.advisorId,
        participant: buildParticipant(notice.advisorId, {
          metaLabel: advisoryMetaLabel("ready", notice.wakeKind),
          state: "ready",
          wakeKind: notice.wakeKind
        })
      }))
    };
  }

  return {
    advisoryMetaLabel,
    applyCompanionWakeupAction,
    buildSelectedCompanionState,
    companionActionMessage,
    defaultAdvisoryState,
    ensureThreadCompanionState,
    isCompanionWakeupVisible,
    normalizeCompanionThreadState,
    pruneAllCompanionWakeups,
    pruneCompanionWakeupsForThread,
    queueCompanionWakeup,
    resetCompanionWakeups,
    setThreadCompanionState,
    summonCompanionWakeup
  };
}
