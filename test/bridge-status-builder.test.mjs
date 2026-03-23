import test from "node:test";
import assert from "node:assert/strict";

import { createBridgeStatusBuilder } from "../src/lib/bridge-status-builder.mjs";

test("bridge status builder shapes runtime, diagnostics, and selected-thread status", () => {
  const liveState = {
    controlLease: { threadId: "thr_dextunnel" },
    lastError: "watcher stale",
    lastSyncAt: "2026-03-20T17:05:00.000Z",
    selectedProjectCwd: "/tmp/dextunnel",
    selectedThreadId: "thr_dextunnel",
    selectedThreadSnapshot: {
      thread: {
        id: "thr_dextunnel"
      }
    },
    selectionSource: "remote",
    watcherConnected: true,
    writeLock: { status: "pending", threadId: "thr_dextunnel" }
  };

  const buildBridgeStatus = createBridgeStatusBuilder({
    appServerState: {
      lastControlEvent: { id: "control-1" },
      lastInteraction: { id: "interaction-1" },
      lastSelectionEvent: { id: "selection-1" },
      lastSurfaceEvent: { id: "surface-1" },
      lastWrite: { id: "write-1" }
    },
    buildOperatorDiagnostics: ({ bridgeStatus, controlLeaseForSelection, selectedAttachments }) => [
      {
        code: `${bridgeStatus.watcherConnected ? "bridge_ok" : "bridge_bad"}:${controlLeaseForSelection?.threadId || "none"}:${selectedAttachments.length}`
      }
    ],
    buildSelectedAttachments: (threadId) => [{ id: `${threadId}:attachment` }],
    codexAppServer: {
      getStatus: () => ({
        lastError: "from bridge",
        watcherConnected: true
      })
    },
    devToolsEnabled: true,
    getControlLeaseForSelectedThread: () => ({ owner: "remote", threadId: "thr_dextunnel" }),
    getLastControlEventForSelectedThread: () => ({ id: "control-selected" }),
    getLastInteractionForSelectedThread: () => ({ id: "interaction-selected" }),
    getLastSelectionEventForSelectedThread: () => ({ id: "selection-selected" }),
    getLastSurfaceEventForSelectedThread: () => ({ id: "surface-selected" }),
    getLastWriteForSelectedThread: () => ({ id: "write-selected" }),
    liveState,
    runtimeProfile: "release"
  });

  assert.deepEqual(buildBridgeStatus(), {
    controlLease: { threadId: "thr_dextunnel" },
    controlLeaseForSelection: { owner: "remote", threadId: "thr_dextunnel" },
    devToolsEnabled: true,
    diagnostics: [{ code: "bridge_ok:thr_dextunnel:1" }],
    lastControlEvent: { id: "control-1" },
    lastControlEventForSelection: { id: "control-selected" },
    lastError: "watcher stale",
    lastInteraction: { id: "interaction-1" },
    lastInteractionForSelection: { id: "interaction-selected" },
    lastSelectionEvent: { id: "selection-1" },
    lastSelectionEventForSelection: { id: "selection-selected" },
    lastSurfaceEvent: { id: "surface-1" },
    lastSurfaceEventForSelection: { id: "surface-selected" },
    lastSyncAt: "2026-03-20T17:05:00.000Z",
    lastWrite: { id: "write-1" },
    lastWriteForSelection: { id: "write-selected" },
    runtimeProfile: "release",
    selectionMode: "shared-room",
    selectionSource: "remote",
    selectedProjectCwd: "/tmp/dextunnel",
    selectedThreadId: "thr_dextunnel",
    watcherConnected: true,
    writeLock: { status: "pending", threadId: "thr_dextunnel" }
  });
});
