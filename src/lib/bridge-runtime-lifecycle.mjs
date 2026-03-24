export function createBridgeRuntimeLifecycleService({
  broadcast = () => {},
  buildLivePayload = () => ({}),
  cleanupAttachmentDir = async () => {},
  codexAppServer,
  liveState,
  prewarmThreadSnapshots = async () => {},
  refreshSelectedThreadSnapshot = async () => {},
  refreshThreads = async () => {},
  restartWatcher = async () => {},
  scheduleSnapshotRefresh = () => {}
} = {}) {
  async function interruptSelectedThread() {
    const thread = liveState.selectedThreadSnapshot?.thread || null;
    if (!thread?.id) {
      throw new Error("No live Codex thread is selected.");
    }

    if (!thread.activeTurnId) {
      throw new Error("The selected thread is not currently running.");
    }

    await codexAppServer.interruptTurn({
      threadId: thread.id,
      turnId: thread.activeTurnId
    });

    liveState.writeLock = null;
    liveState.lastError = null;
    scheduleSnapshotRefresh(100);
    broadcast("live", buildLivePayload());

    return {
      ok: true,
      state: buildLivePayload()
    };
  }

  async function bootstrapLiveState() {
    await cleanupAttachmentDir();
    await refreshThreads({ broadcastUpdate: false });
    await refreshSelectedThreadSnapshot({ broadcastUpdate: false });
    void prewarmThreadSnapshots({ excludeThreadId: liveState.selectedThreadId });
    await restartWatcher();
  }

  return {
    bootstrapLiveState,
    interruptSelectedThread
  };
}
