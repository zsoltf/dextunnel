export function createThreadSyncStateService({
  broadcast = () => {},
  buildLivePayload = () => ({}),
  buildLightweightSelectedThreadSnapshot = null,
  clearControlLease = () => {},
  codexAppServer,
  fallbackLiveSourceKinds = ["vscode", "cli"],
  liveState,
  loadThreadAgentRoomState = async () => {},
  mapThreadToCompanionSnapshot,
  nowIso = () => new Date().toISOString(),
  preferredLiveSourceKinds = ["vscode"],
  processCwd = () => process.cwd(),
  snapshotNeedsDeepHydration = () => false,
  selectedTranscriptLimit = 120,
  summarizeThread = (thread) => thread,
  buildSelectedThreadSnapshot = (thread, { limit = selectedTranscriptLimit } = {}) => (
    mapThreadToCompanionSnapshot(thread, { limit })
  ),
  buildThreadSummary = (thread) => summarizeThread(thread),
  readSelectedThread = (threadId) => codexAppServer.readThread(threadId, true),
} = {}) {
  const threadSummaryCache = new Map();
  const selectedSnapshotCache = new Map();
  const selectedSnapshotWarmers = new Map();
  const preservedTranscriptLimit = Math.max(selectedTranscriptLimit * 2, 24);
  const buildQuickSelectedThreadSnapshot =
    typeof buildLightweightSelectedThreadSnapshot === "function"
      ? buildLightweightSelectedThreadSnapshot
      : null;

  function pruneCache(cache, maxEntries = 240) {
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey == null) {
        break;
      }
      cache.delete(oldestKey);
    }
  }

  function threadCacheKey(thread) {
    return [
      thread?.id || "",
      thread?.updatedAt || "",
      thread?.path || "",
      thread?.preview || ""
    ].join("|");
  }

  async function warmSelectedThreadSnapshotForThread(thread, { limit = selectedTranscriptLimit } = {}) {
    if (!thread?.id) {
      return null;
    }

    const snapshotCacheKey = threadCacheKey(thread);
    const cached = snapshotCacheKey ? selectedSnapshotCache.get(snapshotCacheKey) : null;
    if (cached) {
      return cached;
    }

    const existing = selectedSnapshotWarmers.get(thread.id);
    if (existing?.cacheKey === snapshotCacheKey) {
      return existing.promise;
    }

    const promise = Promise.resolve(buildSelectedThreadSnapshot(thread, { limit }))
      .then((snapshot) => {
        if (snapshotCacheKey && snapshot) {
          selectedSnapshotCache.set(snapshotCacheKey, snapshot);
          pruneCache(selectedSnapshotCache, 48);
        }
        return snapshot;
      })
      .finally(() => {
        const current = selectedSnapshotWarmers.get(thread.id);
        if (current?.promise === promise) {
          selectedSnapshotWarmers.delete(thread.id);
        }
      });

    selectedSnapshotWarmers.set(thread.id, {
      cacheKey: snapshotCacheKey,
      promise
    });
    return promise;
  }

  function transcriptEntryMergeKey(entry = {}) {
    if (entry?.itemId) {
      return `item:${entry.itemId}`;
    }

    if (entry?.turnId) {
      return `turn:${entry.turnId}|${entry?.role || ""}|${entry?.kind || ""}`;
    }

    return "";
  }

  function normalizeTranscriptText(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function transcriptTimestampBucket(value = "") {
    const ms = new Date(value || 0).getTime();
    if (!Number.isFinite(ms) || ms <= 0) {
      return "";
    }

    return String(Math.floor(ms / 1000));
  }

  function transcriptEntrySemanticKey(entry = {}) {
    const text = normalizeTranscriptText(entry?.text || "");
    if (!text) {
      return "";
    }

    return [
      entry?.role || "",
      entry?.kind || "",
      transcriptTimestampBucket(entry?.timestamp || ""),
      text
    ].join("|");
  }

  function mergeSelectedThreadSnapshot(previousSnapshot, nextSnapshot) {
    const previousThreadId = previousSnapshot?.thread?.id || null;
    const nextThreadId = nextSnapshot?.thread?.id || null;
    if (!previousThreadId || previousThreadId !== nextThreadId) {
      return nextSnapshot;
    }

    const previousTranscript = Array.isArray(previousSnapshot?.transcript) ? previousSnapshot.transcript : [];
    const nextTranscript = Array.isArray(nextSnapshot?.transcript) ? nextSnapshot.transcript : [];
    if (previousTranscript.length === 0 || nextTranscript.length === 0) {
      return nextSnapshot;
    }

    const merged = [];
    const seenIdentityKeys = new Set();
    const seenSemanticKeys = new Set();
    for (const entry of [...previousTranscript, ...nextTranscript]) {
      const identityKey = transcriptEntryMergeKey(entry);
      const semanticKey = transcriptEntrySemanticKey(entry);
      if (
        (identityKey && seenIdentityKeys.has(identityKey)) ||
        (semanticKey && seenSemanticKeys.has(semanticKey))
      ) {
        continue;
      }

      if (identityKey) {
        seenIdentityKeys.add(identityKey);
      }
      if (semanticKey) {
        seenSemanticKeys.add(semanticKey);
      }
      merged.push(entry);
    }

    return {
      ...nextSnapshot,
      transcript: merged.slice(-preservedTranscriptLimit),
      transcriptCount: Math.max(
        Number.isFinite(previousSnapshot?.transcriptCount) ? previousSnapshot.transcriptCount : previousTranscript.length,
        Number.isFinite(nextSnapshot?.transcriptCount) ? nextSnapshot.transcriptCount : nextTranscript.length,
        merged.length
      )
    };
  }

  function setSelectedSnapshotHydrationState(snapshot, transcriptHydrating = false) {
    if (!snapshot) {
      return snapshot;
    }

    return {
      ...snapshot,
      transcriptHydrating: Boolean(transcriptHydrating),
      thread: snapshot.thread
        ? {
            ...snapshot.thread,
            transcriptHydrating: Boolean(transcriptHydrating)
          }
        : snapshot.thread
    };
  }

  async function refreshThreadSummary(thread) {
    if (!thread) {
      return;
    }

    const summaryCacheKey = threadCacheKey(thread);
    const summary = threadSummaryCache.get(summaryCacheKey) || await buildThreadSummary(thread);
    threadSummaryCache.set(summaryCacheKey, summary);
    pruneCache(threadSummaryCache);
    const index = liveState.threads.findIndex((entry) => entry.id === thread.id);
    if (index >= 0) {
      liveState.threads = liveState.threads.map((entry, entryIndex) => (
        entryIndex === index
          ? {
              ...entry,
              ...summary,
              id: entry.id
            }
          : entry
      ));
    } else {
      liveState.threads = [summary, ...liveState.threads];
    }
  }

  async function commitSelectedThreadSnapshot(thread, snapshot) {
    const previousSnapshot = liveState.selectedThreadSnapshot;
    liveState.selectedThreadSnapshot = thread && snapshot
      ? mergeSelectedThreadSnapshot(previousSnapshot, snapshot)
      : thread
        ? snapshot
        : null;
    liveState.selectedProjectCwd = thread?.cwd || liveState.selectedProjectCwd;
    await refreshThreadSummary(thread);
    liveState.lastSyncAt = nowIso();
    liveState.lastError = null;
  }

  function hydrateSelectedThreadSnapshotInBackground(thread, requestedThreadId) {
    if (!thread?.id || !requestedThreadId) {
      return;
    }

    void warmSelectedThreadSnapshotForThread(thread, { limit: selectedTranscriptLimit })
      .then(async (snapshot) => {
        if (liveState.selectedThreadId !== requestedThreadId) {
          return;
        }

        await commitSelectedThreadSnapshot(
          thread,
          setSelectedSnapshotHydrationState(snapshot, false)
        );
        broadcast("live", buildLivePayload());
      })
      .catch((error) => {
        if (liveState.selectedThreadId !== requestedThreadId) {
          return;
        }

        if (liveState.selectedThreadSnapshot?.thread?.id === requestedThreadId) {
          liveState.selectedThreadSnapshot = setSelectedSnapshotHydrationState(
            liveState.selectedThreadSnapshot,
            false
          );
        }
        liveState.lastError = error?.message || "Thread refresh failed.";
        broadcast("live", buildLivePayload());
      });
  }

  function maybePickFallbackSelection() {
    const previousThreadId = liveState.selectedThreadId;
    if (liveState.selectedThreadId && liveState.threads.some((thread) => thread.id === liveState.selectedThreadId)) {
      return;
    }

    const preferred =
      liveState.threads.find((thread) => thread.cwd === liveState.selectedProjectCwd) ||
      liveState.threads.find((thread) => thread.cwd === processCwd()) ||
      liveState.threads[0] ||
      null;

    liveState.selectedProjectCwd = preferred?.cwd || processCwd();
    liveState.selectedThreadId = preferred?.id || null;
    if (liveState.selectedThreadId !== previousThreadId) {
      clearControlLease({ broadcastUpdate: false });
    }
  }

  async function hydrateThreadSummaries(threads = []) {
    if (!Array.isArray(threads) || threads.length === 0) {
      return [];
    }

    const existingById = new Map(
      (Array.isArray(liveState.threads) ? liveState.threads : [])
        .filter((thread) => thread?.id)
        .map((thread) => [thread.id, thread])
    );

    const hydrated = await Promise.all(
      threads.map(async (thread) => {
        const base = {
          ...(existingById.get(thread.id) || {}),
          ...(thread || {})
        };

        try {
          const cacheKey = threadCacheKey(base);
          const cached = threadSummaryCache.get(cacheKey);
          if (cached) {
            return {
              ...base,
              ...cached,
              id: thread.id
            };
          }

          const summary = await buildThreadSummary(base);
          threadSummaryCache.set(cacheKey, summary);
          pruneCache(threadSummaryCache);
          return {
            ...base,
            ...summary,
            id: thread.id
          };
        } catch {
          return base;
        }
      })
    );

    return hydrated;
  }

  function prewarmPriority(thread, index) {
    let score = Math.max(0, 40 - index);
    if (thread?.cwd && thread.cwd === liveState.selectedProjectCwd) {
      score += 120;
    }
    if (thread?.cwd && thread.cwd === processCwd()) {
      score += 80;
    }
    if (thread?.activeTurnId) {
      score += 24;
    }
    if (thread?.source === "vscode") {
      score += 12;
    }
    return score;
  }

  async function prewarmThreadSnapshots({
    excludeThreadId = null,
    limit = selectedTranscriptLimit,
    maxThreads = 3,
    threads = liveState.threads
  } = {}) {
    const normalizedExcludeThreadId = String(excludeThreadId || "").trim();
    const candidates = (Array.isArray(threads) ? threads : [])
      .map((thread, index) => ({
        index,
        priority: prewarmPriority(thread, index),
        thread
      }))
      .filter(({ thread }) => thread?.id && thread.id !== normalizedExcludeThreadId)
      .sort((a, b) => {
        const priorityDelta = b.priority - a.priority;
        return priorityDelta !== 0 ? priorityDelta : a.index - b.index;
      })
      .slice(0, Math.max(0, Number.parseInt(maxThreads, 10) || 0))
      .map(({ thread }) => thread);

    for (const thread of candidates) {
      const cacheKey = threadCacheKey(thread);
      if (cacheKey && selectedSnapshotCache.has(cacheKey)) {
        continue;
      }

      try {
        const hydratedThread = await readSelectedThread(thread.id);
        if (!hydratedThread) {
          continue;
        }
        await warmSelectedThreadSnapshotForThread(hydratedThread, { limit });
      } catch {
        // Background warmers are a best-effort polish path only.
      }
    }
  }

  async function refreshThreads({ broadcastUpdate = true } = {}) {
    try {
      let threads = await codexAppServer.listThreads({
        cwd: null,
        limit: 60,
        archived: false,
        sourceKinds: preferredLiveSourceKinds
      });

      if (threads.length === 0) {
        threads = await codexAppServer.listThreads({
          cwd: null,
          limit: 60,
          archived: false,
          sourceKinds: fallbackLiveSourceKinds
        });
      }

      liveState.threads = await hydrateThreadSummaries(threads);
      maybePickFallbackSelection();
      liveState.lastError = null;
    } catch (error) {
      liveState.lastError = error.message;
    }

    if (broadcastUpdate) {
      broadcast("live", buildLivePayload());
    }
  }

  async function refreshSelectedThreadSnapshot({ broadcastUpdate = true } = {}) {
    const requestedThreadId = liveState.selectedThreadId;

    if (!requestedThreadId) {
      liveState.selectedThreadSnapshot = null;
      liveState.turnDiff = null;
      if (broadcastUpdate) {
        broadcast("live", buildLivePayload());
      }
      return;
    }

    try {
      const thread = await readSelectedThread(requestedThreadId);
      await loadThreadAgentRoomState(requestedThreadId);
      if (liveState.selectedThreadId !== requestedThreadId) {
        return;
      }
      const snapshotCacheKey = thread ? threadCacheKey(thread) : null;
      const cachedSnapshot = snapshotCacheKey ? selectedSnapshotCache.get(snapshotCacheKey) : null;
      if (cachedSnapshot) {
        await commitSelectedThreadSnapshot(
          thread,
          setSelectedSnapshotHydrationState(cachedSnapshot, false)
        );
      } else if (thread && buildQuickSelectedThreadSnapshot) {
        const quickSnapshot = await buildQuickSelectedThreadSnapshot(thread, {
          limit: selectedTranscriptLimit
        });
        if (liveState.selectedThreadId !== requestedThreadId) {
          return;
        }

        const needsDeepHydration = snapshotNeedsDeepHydration(quickSnapshot, {
          limit: selectedTranscriptLimit,
          thread
        });
        await commitSelectedThreadSnapshot(
          thread,
          setSelectedSnapshotHydrationState(quickSnapshot, needsDeepHydration)
        );
        if (needsDeepHydration) {
          if (broadcastUpdate) {
            broadcast("live", buildLivePayload());
          }
          hydrateSelectedThreadSnapshotInBackground(thread, requestedThreadId);
          return;
        }
      } else if (thread) {
        const snapshot = await warmSelectedThreadSnapshotForThread(thread, {
          limit: selectedTranscriptLimit
        });
        if (liveState.selectedThreadId !== requestedThreadId) {
          return;
        }
        await commitSelectedThreadSnapshot(
          thread,
          setSelectedSnapshotHydrationState(snapshot, false)
        );
      } else {
        liveState.selectedThreadSnapshot = null;
      }
    } catch (error) {
      liveState.lastError = error.message;
    }

    if (broadcastUpdate) {
      broadcast("live", buildLivePayload());
    }
  }

  async function refreshLiveState({ includeThreads = true } = {}) {
    if (includeThreads) {
      await refreshThreads({ broadcastUpdate: false });
    }
    await refreshSelectedThreadSnapshot({ broadcastUpdate: false });
    broadcast("live", buildLivePayload());
    return buildLivePayload();
  }

  async function createThreadSelectionState({
    cwd = null,
    source = "remote"
  } = {}) {
    const targetCwd = cwd || liveState.selectedProjectCwd || processCwd();
    const createdThread = await codexAppServer.startThread({
      cwd: targetCwd,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      ephemeral: false,
      persistExtendedHistory: true
    });
    const hydratedThread = await codexAppServer.readThread(createdThread.id, true);
    const snapshot = mapThreadToCompanionSnapshot(hydratedThread, { limit: selectedTranscriptLimit });

    liveState.selectionSource = source;
    liveState.selectedProjectCwd = hydratedThread.cwd || targetCwd;
    liveState.selectedThreadId = hydratedThread.id;
    liveState.selectedThreadSnapshot = snapshot;
    clearControlLease({ broadcastUpdate: false });
    liveState.turnDiff = null;
    liveState.lastSyncAt = nowIso();
    liveState.lastError = null;
    liveState.threads = [
      summarizeThread(hydratedThread),
      ...liveState.threads.filter((thread) => thread.id !== hydratedThread.id)
    ];

    return {
      snapshot,
      thread: hydratedThread
    };
  }

  return {
    createThreadSelectionState,
    mergeSelectedThreadSnapshot,
    maybePickFallbackSelection,
    prewarmThreadSnapshots,
    refreshLiveState,
    refreshSelectedThreadSnapshot,
    refreshThreads
  };
}
