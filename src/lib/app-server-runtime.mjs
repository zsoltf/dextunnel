import { createCodexAppServerBridge } from "./codex-app-server-client.mjs";
import { createFakeCodexAppServerBridge } from "./fake-codex-app-server-bridge.mjs";

export function createAppServerState() {
  return {
    lastControlEvent: null,
    lastInteraction: null,
    lastSelectionEvent: null,
    lastSurfaceEvent: null,
    lastWrite: null
  };
}

export function createLiveState({ cwd = process.cwd() } = {}) {
  return {
    agentRoomByThreadId: {},
    companionByThreadId: {},
    controlLease: null,
    interactionFlow: null,
    lastError: null,
    lastSyncAt: null,
    pendingInteraction: null,
    selectedProjectCwd: cwd,
    selectionSource: "remote",
    surfacePresenceByClientId: {},
    selectedThreadId: null,
    selectedThreadSnapshot: null,
    threads: [],
    turnDiff: null,
    turnOriginsByThreadId: {},
    watcherConnected: false,
    writeLock: null
  };
}

export function createCodexRuntime({
  binaryPath,
  cwd = process.cwd(),
  listenUrl,
  useFakeAppServer = false,
  fakeSendDelayMs = 0
} = {}) {
  const codexAppServer = useFakeAppServer
    ? createFakeCodexAppServerBridge({
        binaryPath,
        cwd,
        listenUrl,
        sendDelayMs: fakeSendDelayMs
      })
    : createCodexAppServerBridge({
        binaryPath,
        listenUrl
      });

  return {
    appServerState: createAppServerState(),
    codexAppServer,
    liveState: createLiveState({ cwd })
  };
}
