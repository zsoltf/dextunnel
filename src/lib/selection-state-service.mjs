export function createSelectionStateService({
  appServerState,
  applyLiveSelectionTransition,
  bestThreadLabel,
  broadcast = () => {},
  buildLivePayload = () => ({}),
  createThreadSelectionState,
  getPendingInteractionForSelectedThread = () => null,
  liveState,
  nowIso = () => new Date().toISOString(),
  nowMs = () => Date.now(),
  projectLabel,
  randomId = () => `${Date.now()}`,
  refreshSelectedThreadSnapshot = async () => {},
  refreshThreads = async () => {},
  restartWatcher = async () => {},
  scheduleControlLeaseExpiry = () => {},
  shortThreadId = (value) => String(value || "").trim(),
  slugifyChannelName = (value) => String(value || "").trim().toLowerCase(),
  surfaceActorLabel = ({ surface = "", clientId = null } = {}) =>
    clientId ? `${surface}:${clientId}` : surface
} = {}) {
  function restartWatcherInBackground() {
    void restartWatcher().catch((error) => {
      liveState.lastError = error?.message || "Watcher restart failed.";
      broadcast("live", buildLivePayload());
    });
  }

  function hydrateSelectionInBackground(expectedThreadId) {
    const normalizedThreadId = String(expectedThreadId || "").trim();
    if (!normalizedThreadId) {
      return;
    }

    void refreshSelectedThreadSnapshot({ broadcastUpdate: true }).catch((error) => {
      if (liveState.selectedThreadId !== normalizedThreadId) {
        return;
      }

      liveState.lastError = error?.message || "Thread refresh failed.";
      broadcast("live", buildLivePayload());
    });
  }

  function threadDescriptor(threadId, snapshot = null) {
    const id = String(threadId || "").trim();
    if (!id) {
      return {
        channelLabel: "",
        channelSlug: "",
        cwd: null,
        serverLabel: "",
        threadId: null
      };
    }

    const snapshotThread = snapshot?.thread?.id === id ? snapshot.thread : null;
    const thread = snapshotThread || liveState.threads.find((candidate) => candidate.id === id) || null;
    const channelLabel = thread
      ? bestThreadLabel(thread, snapshotThread ? snapshot : null, { selected: true })
      : `session ${shortThreadId(id)}`;
    const cwd = thread?.cwd || null;

    return {
      channelLabel,
      channelSlug: `#${slugifyChannelName(channelLabel)}`,
      cwd,
      serverLabel: projectLabel(cwd || ""),
      threadId: id
    };
  }

  function recordSelectionEvent({
    actor = "remote",
    clientId = null,
    cause = "switched",
    fromDescriptor = null,
    toDescriptor = null
  } = {}) {
    const nextThreadId = String(toDescriptor?.threadId || "").trim();
    if (!nextThreadId) {
      return null;
    }

    appServerState.lastSelectionEvent = {
      action: "switch",
      actor,
      actorClientId: clientId ? String(clientId).trim() : null,
      actorLabel: surfaceActorLabel({ surface: actor, clientId }),
      at: nowIso(),
      cause,
      fromChannelLabel: fromDescriptor?.channelLabel || "",
      fromChannelSlug: fromDescriptor?.channelSlug || "",
      fromServerLabel: fromDescriptor?.serverLabel || "",
      fromThreadId: fromDescriptor?.threadId || null,
      id: randomId(),
      threadId: nextThreadId,
      toChannelLabel: toDescriptor?.channelLabel || "",
      toChannelSlug: toDescriptor?.channelSlug || "",
      toServerLabel: toDescriptor?.serverLabel || "",
      toThreadId: nextThreadId
    };
    return appServerState.lastSelectionEvent;
  }

  async function setSelection({ clientId = null, cwd = null, source = "remote", threadId = null } = {}) {
    const previousThreadId = liveState.selectedThreadId;
    const previousDescriptor = threadDescriptor(previousThreadId, liveState.selectedThreadSnapshot);
    const selection = applyLiveSelectionTransition(
      {
        controlLease: liveState.controlLease,
        interactionFlow: liveState.interactionFlow,
        selectedProjectCwd: liveState.selectedProjectCwd,
        selectedThreadId: liveState.selectedThreadId,
        selectedThreadSnapshot: liveState.selectedThreadSnapshot,
        selectionSource: liveState.selectionSource,
        turnDiff: liveState.turnDiff,
        writeLock: liveState.writeLock
      },
      {
        cwd,
        source,
        threadId,
        threads: liveState.threads
      },
      {
        now: nowMs()
      }
    );

    liveState.selectedProjectCwd = selection.nextState.selectedProjectCwd;
    liveState.selectionSource = selection.nextState.selectionSource;
    liveState.selectedThreadId = selection.nextState.selectedThreadId;
    liveState.selectedThreadSnapshot = selection.nextState.selectedThreadSnapshot;
    liveState.writeLock = selection.nextState.writeLock;
    liveState.turnDiff = selection.nextState.turnDiff;
    liveState.controlLease = selection.nextState.controlLease;
    liveState.interactionFlow = selection.nextState.interactionFlow;

    if (selection.threadChanged) {
      scheduleControlLeaseExpiry();
    }

    liveState.lastError = null;
    if (selection.threadChanged) {
      liveState.watcherConnected = false;
    } else {
      await refreshSelectedThreadSnapshot({ broadcastUpdate: false });
    }
    if (liveState.selectedThreadId && liveState.selectedThreadId !== previousThreadId) {
      recordSelectionEvent({
        actor: source,
        cause: "switched",
        clientId,
        fromDescriptor: previousDescriptor,
        toDescriptor: threadDescriptor(liveState.selectedThreadId, liveState.selectedThreadSnapshot)
      });
    }
    broadcast("live", buildLivePayload());
    if (selection.threadChanged) {
      hydrateSelectionInBackground(liveState.selectedThreadId);
    }
    restartWatcherInBackground();
    void refreshThreads({ broadcastUpdate: true });

    return {
      ok: true,
      source,
      state: buildLivePayload()
    };
  }

  async function createThreadSelection({ clientId = null, cwd = null, source = "remote" } = {}) {
    const previousDescriptor = threadDescriptor(liveState.selectedThreadId, liveState.selectedThreadSnapshot);
    if (getPendingInteractionForSelectedThread()) {
      throw new Error("Resolve the pending interaction before creating a new session.");
    }

    if (liveState.writeLock?.status) {
      throw new Error("Wait for the current live write to finish before creating a new session.");
    }

    const { snapshot, thread: hydratedThread } = await createThreadSelectionState({
      cwd,
      source
    });
    recordSelectionEvent({
      actor: source,
      cause: "created",
      clientId,
      fromDescriptor: previousDescriptor,
      toDescriptor: threadDescriptor(hydratedThread.id, snapshot)
    });

    broadcast("live", buildLivePayload());
    restartWatcherInBackground();
    void refreshThreads({ broadcastUpdate: true });

    return {
      ok: true,
      source,
      state: buildLivePayload(),
      thread: snapshot.thread
    };
  }

  return {
    createThreadSelection,
    recordSelectionEvent,
    setSelection,
    threadDescriptor
  };
}
