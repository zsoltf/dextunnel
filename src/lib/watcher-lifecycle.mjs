export function createWatcherLifecycleService({
  appServerState,
  applyWatcherNotification = () => false,
  beginInteractionFlow = () => null,
  broadcast = () => {},
  buildLivePayload = () => ({}),
  clearInteractionFlow = () => {},
  codexAppServer,
  invalidateRepoChangesCache = () => {},
  liveState,
  mapPendingInteraction = () => null,
  maybeWakeCompanionForCompaction = () => {},
  maybeWakeCompanionForInteractionResolution = () => {},
  maybeWakeCompanionForTurnCompletion = () => {},
  nowIso = () => new Date().toISOString(),
  refreshSelectedThreadSnapshot = async () => {},
  rememberTurnOrigin = () => {},
  resetCompanionWakeups = () => {},
  summarizeNotificationInteraction = () => null,
  watchRefreshMethods = new Set(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  let snapshotRefreshTimer = null;
  let snapshotSettleRefreshTimer = null;
  let watchReconnectTimer = null;
  let watcherController = null;
  let watcherToken = 0;

  function scheduleSnapshotRefresh(delay = 180) {
    if (snapshotRefreshTimer) {
      clearTimeoutFn(snapshotRefreshTimer);
    }

    snapshotRefreshTimer = setTimeoutFn(() => {
      snapshotRefreshTimer = null;
      void refreshSelectedThreadSnapshot();
    }, delay);
  }

  function clearWatcher() {
    if (watchReconnectTimer) {
      clearTimeoutFn(watchReconnectTimer);
      watchReconnectTimer = null;
    }

    if (snapshotSettleRefreshTimer) {
      clearTimeoutFn(snapshotSettleRefreshTimer);
      snapshotSettleRefreshTimer = null;
    }

    if (watcherController) {
      watcherController.close();
      watcherController = null;
    }

    liveState.watcherConnected = false;
  }

  function scheduleWatcherReconnect(threadId, token) {
    if (watchReconnectTimer) {
      clearTimeoutFn(watchReconnectTimer);
    }

    watchReconnectTimer = setTimeoutFn(() => {
      if (token !== watcherToken || liveState.selectedThreadId !== threadId) {
        return;
      }

      void restartWatcher();
    }, 1200);
  }

  function scheduleSnapshotSettleRefresh(delay = 1400) {
    if (snapshotSettleRefreshTimer) {
      clearTimeoutFn(snapshotSettleRefreshTimer);
    }

    snapshotSettleRefreshTimer = setTimeoutFn(() => {
      snapshotSettleRefreshTimer = null;
      void refreshSelectedThreadSnapshot();
    }, delay);
  }

  function handleServerRequest(request) {
    liveState.pendingInteraction = mapPendingInteraction(request, beginInteractionFlow(request));
    appServerState.lastInteraction = summarizeNotificationInteraction(liveState.pendingInteraction, request);
    broadcast("live", buildLivePayload());
  }

  function handleServerRequestResolved(message, threadId) {
    const resolvedRequestId = message.params?.requestId || null;
    const wasPending = liveState.pendingInteraction?.requestId === resolvedRequestId;
    const wasJustResponded =
      appServerState.lastInteraction?.requestId === resolvedRequestId &&
      appServerState.lastInteraction?.status === "responded";
    const nextInteractionThreadId = message.params?.threadId || appServerState.lastInteraction?.threadId || null;

    if (wasPending) {
      liveState.pendingInteraction = null;
    }

    appServerState.lastInteraction = {
      action: appServerState.lastInteraction?.action || null,
      at: nowIso(),
      flowContinuation: appServerState.lastInteraction?.flowContinuation || "",
      flowLabel: appServerState.lastInteraction?.flowLabel || "",
      flowStep: appServerState.lastInteraction?.flowStep || null,
      itemId: appServerState.lastInteraction?.itemId || null,
      kind: appServerState.lastInteraction?.kind || "interaction",
      kindLabel: appServerState.lastInteraction?.kindLabel || null,
      requestId: resolvedRequestId,
      retryAttempt: appServerState.lastInteraction?.retryAttempt || 1,
      summary: appServerState.lastInteraction?.summary || null,
      source: "app-server",
      status: wasPending || wasJustResponded ? "resolved" : "cleared",
      threadId: nextInteractionThreadId,
      turnId: appServerState.lastInteraction?.turnId || null
    };

    if (appServerState.lastInteraction.status === "resolved") {
      maybeWakeCompanionForInteractionResolution({
        interaction: appServerState.lastInteraction,
        threadId: nextInteractionThreadId
      });
    }

    broadcast("live", buildLivePayload());
    scheduleSnapshotRefresh(60);
  }

  function handleTurnStarted(message, threadId, cwd) {
    invalidateRepoChangesCache({ cwd });
    rememberTurnOrigin(
      threadId,
      message.params?.turn?.id || null,
      liveState.writeLock?.source || null
    );
    resetCompanionWakeups(message.params?.threadId || threadId, { preserveLastWake: true });
    liveState.writeLock = {
      at: nowIso(),
      source: liveState.writeLock?.source || "external",
      status: "running",
      threadId
    };
    liveState.turnDiff = {
      cwd,
      diff: "",
      threadId,
      turnId: message.params?.turn?.id || null,
      updatedAt: nowIso()
    };
    applyWatcherNotification(message, { threadId, cwd });
    broadcast("live", buildLivePayload());
  }

  function handleTurnCompleted(message, threadId, cwd) {
    invalidateRepoChangesCache({ cwd });
    clearInteractionFlow({ threadId: message.params?.threadId || threadId });
    liveState.writeLock = null;
    applyWatcherNotification(message, { threadId, cwd });
    maybeWakeCompanionForTurnCompletion({
      threadId: message.params?.threadId || threadId,
      turnId: message.params?.turn?.id || message.params?.turnId || null
    });
    broadcast("live", buildLivePayload());
    scheduleSnapshotRefresh(80);
    scheduleSnapshotSettleRefresh(1400);
  }

  function handleTurnDiffUpdated(message, threadId, cwd) {
    invalidateRepoChangesCache({ cwd });
    liveState.turnDiff = {
      cwd,
      diff: message.params?.diff || "",
      threadId: message.params?.threadId || threadId,
      turnId: message.params?.turnId || liveState.turnDiff?.turnId || null,
      updatedAt: nowIso()
    };
    broadcast("live", buildLivePayload());
  }

  function handleNotification(message, threadId, cwd) {
    if (message.method === "serverRequest/resolved") {
      handleServerRequestResolved(message, threadId);
      return;
    }

    if (message.method === "turn/started") {
      handleTurnStarted(message, threadId, cwd);
      return;
    }

    if (message.method === "turn/completed") {
      handleTurnCompleted(message, threadId, cwd);
      return;
    }

    if (message.method === "turn/diff/updated") {
      handleTurnDiffUpdated(message, threadId, cwd);
      return;
    }

    if (applyWatcherNotification(message, { threadId, cwd })) {
      if (message.method === "thread/compacted") {
        maybeWakeCompanionForCompaction({
          threadId: message.params?.threadId || threadId,
          turnId: message.params?.turnId || null
        });
      }
      broadcast("live", buildLivePayload());
      return;
    }

    if (watchRefreshMethods.has(message.method)) {
      scheduleSnapshotRefresh();
    }
  }

  async function restartWatcher() {
    watcherToken += 1;
    const token = watcherToken;
    const threadId = liveState.selectedThreadId;
    const cwd = liveState.selectedProjectCwd;

    clearWatcher();
    clearInteractionFlow({ threadId });
    liveState.pendingInteraction = null;
    broadcast("live", buildLivePayload());

    if (!threadId) {
      return;
    }

    try {
      watcherController = await codexAppServer.watchThread({
        threadId,
        cwd,
        onClose() {
          if (token !== watcherToken) {
            return;
          }

          clearInteractionFlow({ threadId });
          liveState.pendingInteraction = null;
          liveState.watcherConnected = false;
          broadcast("live", buildLivePayload());
          scheduleWatcherReconnect(threadId, token);
        },
        onError(error) {
          if (token !== watcherToken) {
            return;
          }

          liveState.lastError = error.message;
          clearInteractionFlow({ threadId });
          liveState.pendingInteraction = null;
          liveState.watcherConnected = false;
          broadcast("live", buildLivePayload());
        },
        onReady() {
          if (token !== watcherToken) {
            return;
          }

          liveState.watcherConnected = true;
          liveState.lastError = null;
          scheduleSnapshotRefresh(0);
          broadcast("live", buildLivePayload());
        },
        onServerRequest(request) {
          if (token !== watcherToken) {
            return;
          }

          handleServerRequest(request);
        },
        onNotification(message) {
          if (token !== watcherToken) {
            return;
          }

          handleNotification(message, threadId, cwd);
        }
      });
    } catch (error) {
      if (token !== watcherToken) {
        return;
      }

      liveState.lastError = error.message;
      liveState.watcherConnected = false;
      broadcast("live", buildLivePayload());
      scheduleWatcherReconnect(threadId, token);
    }
  }

  return {
    clearWatcher,
    getWatcherController: () => watcherController,
    hasWatcherController: () => Boolean(watcherController),
    restartWatcher,
    scheduleSnapshotRefresh
  };
}
