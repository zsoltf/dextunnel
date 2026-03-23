import test from "node:test";
import assert from "node:assert/strict";

import { buildOperatorDiagnostics } from "../src/lib/operator-diagnostics.mjs";

test("operator diagnostics call out bridge, host, lease, and desktop limitations distinctly", () => {
  const diagnostics = buildOperatorDiagnostics({
    bridgeStatus: {
      lastError: "socket closed",
      started: false
    },
    controlLeaseForSelection: {
      ownerClientId: "remote-2"
    },
    selectedAttachments: [],
    selectedThreadId: null,
    watcherConnected: false
  });

  assert.deepEqual(
    diagnostics.map((entry) => entry.code),
    [
      "bridge_unavailable",
      "no_selected_room",
      "host_unavailable",
      "control_held",
      "desktop_restart_required",
      "bridge_last_error"
    ]
  );
});

test("operator diagnostics stay calm when the bridge and host are healthy", () => {
  const diagnostics = buildOperatorDiagnostics({
    bridgeStatus: {
      lastError: null,
      started: true
    },
    controlLeaseForSelection: null,
    selectedAttachments: [{ count: 1, surface: "host" }],
    selectedThreadId: "thread-1",
    watcherConnected: true
  });

  assert.deepEqual(
    diagnostics.map((entry) => entry.code),
    ["desktop_restart_required"]
  );
});
