export function createThreadSyncStateService({
  broadcast = () => {},
  buildLivePayload = () => ({}),
  clearControlLease = () => {},
  codexAppServer,
  fallbackLiveSourceKinds = ["vscode", "cli"],
  liveState,
  loadThreadAgentRoomState = async () => {},
  mapThreadToCompanionSnapshot,
  nowIso = () => new Date().toISOString(),
  preferredLiveSourceKinds = ["vscode"],
  processCwd = () => process.cwd(),
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
  const preservedTranscriptLimit = Math.max(selectedTranscriptLimit * 2, 24);

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
      let snapshot = snapshotCacheKey ? selectedSnapshotCache.get(snapshotCacheKey) : null;
      if (!snapshot && thread) {
        snapshot = await buildSelectedThreadSnapshot(thread, { limit: selectedTranscriptLimit });
        selectedSnapshotCache.set(snapshotCacheKey, snapshot);
        pruneCache(selectedSnapshotCache, 48);
      }
      const previousSnapshot = liveState.selectedThreadSnapshot;
      liveState.selectedThreadSnapshot = thread && snapshot
        ? mergeSelectedThreadSnapshot(previousSnapshot, snapshot)
        : thread
          ? snapshot
          : null;
      liveState.selectedProjectCwd = thread?.cwd || liveState.selectedProjectCwd;
      if (thread) {
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
      liveState.lastSyncAt = nowIso();
      liveState.lastError = null;
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
    refreshLiveState,
    refreshSelectedThreadSnapshot,
    refreshThreads
  };
}
