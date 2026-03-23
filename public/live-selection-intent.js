export function createSelectionIntent({
  cwd = null,
  projectLabel = "",
  source = "remote",
  threadId = null,
  threadLabel = ""
} = {}) {
  return {
    projectLabel: String(projectLabel || "").trim(),
    requestedCwd: String(cwd || "").trim(),
    requestedThreadId: String(threadId || "").trim(),
    source: String(source || "remote").trim() || "remote",
    threadLabel: String(threadLabel || "").trim()
  };
}

export function selectionIntentSatisfied(intent = null, liveState = null) {
  if (!intent) {
    return true;
  }

  const requestedThreadId = String(intent.requestedThreadId || "").trim();
  const requestedCwd = String(intent.requestedCwd || "").trim();
  const selectedThreadId = String(liveState?.selectedThreadId || "").trim();
  const selectedCwd = String(liveState?.selectedProjectCwd || "").trim();

  if (requestedThreadId) {
    return selectedThreadId === requestedThreadId;
  }

  if (requestedCwd) {
    return selectedCwd === requestedCwd;
  }

  return true;
}

export function selectionIntentMessage(intent = null, fallback = "Switching shared room...") {
  if (!intent) {
    return fallback;
  }

  if (intent.threadLabel) {
    return `Switching to ${intent.threadLabel}...`;
  }

  if (intent.projectLabel) {
    return `Switching to ${intent.projectLabel}...`;
  }

  return fallback;
}

export function selectionIntentTitle(intent = null) {
  if (!intent) {
    return "";
  }

  const threadLabel = String(intent.threadLabel || "").trim();
  if (!threadLabel) {
    return "";
  }

  const normalized = threadLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized ? `#${normalized}` : "";
}

export function reconcileSelectionIntent(intent = null, liveState = null) {
  const settled = selectionIntentSatisfied(intent, liveState);

  return {
    intent: settled ? null : intent,
    settled
  };
}
