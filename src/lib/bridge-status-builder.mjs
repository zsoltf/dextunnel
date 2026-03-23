export function createBridgeStatusBuilder({
  appServerState,
  buildOperatorDiagnostics,
  buildSelectedAttachments,
  codexAppServer,
  devToolsEnabled = false,
  getControlLeaseForSelectedThread,
  getLastControlEventForSelectedThread,
  getLastInteractionForSelectedThread,
  getLastSelectionEventForSelectedThread,
  getLastSurfaceEventForSelectedThread,
  getLastWriteForSelectedThread,
  liveState,
  runtimeProfile = "dev"
} = {}) {
  if (!appServerState || !codexAppServer || !liveState) {
    throw new Error("createBridgeStatusBuilder requires appServerState, codexAppServer, and liveState.");
  }

  return function buildBridgeStatus() {
    const bridgeStatus = codexAppServer.getStatus();
    const controlLeaseForSelection = getControlLeaseForSelectedThread();
    const selectedAttachments = buildSelectedAttachments(
      liveState.selectedThreadSnapshot?.thread?.id || liveState.selectedThreadId || null
    );

    return {
      ...bridgeStatus,
      controlLease: liveState.controlLease,
      controlLeaseForSelection,
      devToolsEnabled,
      diagnostics: buildOperatorDiagnostics({
        bridgeStatus,
        controlLeaseForSelection,
        selectedAttachments,
        selectedThreadId: liveState.selectedThreadId,
        watcherConnected: liveState.watcherConnected
      }),
      lastControlEvent: appServerState.lastControlEvent,
      lastControlEventForSelection: getLastControlEventForSelectedThread(),
      lastInteraction: appServerState.lastInteraction,
      lastInteractionForSelection: getLastInteractionForSelectedThread(),
      lastError: liveState.lastError || bridgeStatus.lastError,
      lastSelectionEvent: appServerState.lastSelectionEvent,
      lastSelectionEventForSelection: getLastSelectionEventForSelectedThread(),
      lastSurfaceEvent: appServerState.lastSurfaceEvent,
      lastSurfaceEventForSelection: getLastSurfaceEventForSelectedThread(),
      lastSyncAt: liveState.lastSyncAt,
      lastWrite: appServerState.lastWrite,
      lastWriteForSelection: getLastWriteForSelectedThread(),
      runtimeProfile,
      selectionMode: "shared-room",
      selectionSource: liveState.selectionSource,
      selectedProjectCwd: liveState.selectedProjectCwd,
      selectedThreadId: liveState.selectedThreadId,
      watcherConnected: liveState.watcherConnected,
      writeLock: liveState.writeLock
    };
  };
}
