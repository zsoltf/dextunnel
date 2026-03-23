function uniqueByCode(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const code = String(item?.code || "").trim();
    if (!code || seen.has(code)) {
      continue;
    }
    seen.add(code);
    result.push(item);
  }
  return result;
}

function hostSurfaceAttached(selectedAttachments = []) {
  return (selectedAttachments || []).some((entry) => entry?.surface === "host" && Number(entry?.count || 0) > 0);
}

export function buildOperatorDiagnostics({
  bridgeStatus = {},
  controlLeaseForSelection = null,
  selectedAttachments = [],
  selectedThreadId = null,
  watcherConnected = false
} = {}) {
  const diagnostics = [];

  if (!watcherConnected) {
    diagnostics.push({
      code: "bridge_unavailable",
      domain: "network",
      severity: "warn",
      summary: "Session bridge unavailable."
    });
  }

  if (!selectedThreadId) {
    diagnostics.push({
      code: "no_selected_room",
      domain: "room",
      severity: "warn",
      summary: "No shared room selected."
    });
  }

  if (!hostSurfaceAttached(selectedAttachments)) {
    diagnostics.push({
      code: "host_unavailable",
      domain: "host",
      severity: "info",
      summary: "Host surface not attached."
    });
  }

  if (controlLeaseForSelection) {
    diagnostics.push({
      code: "control_held",
      domain: "lease",
      severity: "info",
      summary: "Control is currently held elsewhere."
    });
  }

  diagnostics.push({
    code: "desktop_restart_required",
    domain: "desktop",
    severity: "info",
    summary: "Desktop Codex still requires restart to rehydrate external turns."
  });

  if (bridgeStatus.lastError) {
    diagnostics.push({
      code: "bridge_last_error",
      detail: String(bridgeStatus.lastError),
      domain: "network",
      severity: "warn",
      summary: "Last bridge error recorded."
    });
  }

  return uniqueByCode(diagnostics);
}
