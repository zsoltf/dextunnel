export function cloneReplyAttachments(attachments = []) {
  return attachments.map((attachment) => ({
    dataUrl: attachment.dataUrl,
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.type
  }));
}

export function scopedThreadStorageKey({
  prefix = "",
  scopeId = "",
  threadId = ""
} = {}) {
  const normalizedPrefix = String(prefix || "");
  const normalizedScopeId = String(scopeId || "").trim() || "default";
  const normalizedThreadId = String(threadId || "").trim() || "none";
  return `${normalizedPrefix}${normalizedScopeId}:${normalizedThreadId}`;
}

export function createQueuedReply({
  attachments = [],
  queuedAt = new Date().toISOString(),
  rawText = "",
  sequence = 1,
  threadId = ""
} = {}) {
  const nextThreadId = String(threadId || "").trim();
  if (!nextThreadId) {
    throw new Error("No live session selected.");
  }

  return {
    attachments: cloneReplyAttachments(attachments),
    id: `queued-reply-${Date.now()}-${sequence}`,
    queuedAt,
    text: String(rawText || "").trim(),
    threadId: nextThreadId
  };
}

export function queueSummary(count = 0) {
  const nextCount = Number(count || 0);
  if (nextCount <= 0) {
    return "";
  }

  return nextCount === 1 ? "1 queued" : `${nextCount} queued`;
}

export function sessionBlockedReason({
  hasLiveThread = false,
  watcherConnected = true
} = {}) {
  if (!hasLiveThread) {
    return "No live session selected.";
  }

  if (!watcherConnected) {
    return "Live watcher offline.";
  }

  return "";
}

export function composeBlockedReason({
  pendingInteraction = false,
  sessionReason = ""
} = {}) {
  if (sessionReason) {
    return sessionReason;
  }

  if (pendingInteraction) {
    return "Resolve the pending action first.";
  }

  return "";
}

export function controlBlockedReason({
  hasAnyRemoteControl = false,
  hasRemoteControl = false,
  ownerLabel = "",
  threadId = ""
} = {}) {
  if (!threadId) {
    return "";
  }

  if (hasAnyRemoteControl && !hasRemoteControl) {
    return `${ownerLabel || "Another remote surface"} currently has control.`;
  }

  return hasRemoteControl ? "" : "Take control to send from remote.";
}

export function sendBlockedReason({
  hasAnyRemoteControl = false,
  hasRemoteControl = false,
  ownerLabel = "",
  pendingInteraction = false,
  sessionReason = "",
  threadId = ""
} = {}) {
  return (
    composeBlockedReason({
      pendingInteraction,
      sessionReason
    }) ||
    controlBlockedReason({
      hasAnyRemoteControl,
      hasRemoteControl,
      ownerLabel,
      threadId
    })
  );
}

export function controlClaimRequired(blockedReason = "") {
  return String(blockedReason || "").trim() === "Take control to send from remote.";
}

export function threadBusy({
  activeTurnId = "",
  isSendingReply = false,
  threadStatus = "",
  writeLockStatus = ""
} = {}) {
  const normalizedStatus =
    typeof threadStatus === "string"
      ? threadStatus.trim().toLowerCase()
      : (
          threadStatus &&
          typeof threadStatus === "object" &&
          String(threadStatus.type || threadStatus.status || "").trim().toLowerCase()
        ) || "";
  const statusBusy = ["inprogress", "running"].includes(normalizedStatus);
  return Boolean(isSendingReply || writeLockStatus || activeTurnId || statusBusy);
}

export function canQueueReply({
  controlActive = false,
  hasDraftPayload = false,
  isControlling = false,
  isSelecting = false,
  isSendingReply = false,
  pendingInteraction = false,
  queuedCount = 0,
  sessionBlocked = false,
  threadBusy: busy = false,
  threadId = ""
} = {}) {
  return Boolean(
    threadId &&
      !sessionBlocked &&
      !pendingInteraction &&
      !isSendingReply &&
      !isSelecting &&
      !isControlling &&
      hasDraftPayload
  );
}

export function canSteerReply({
  blockedReason = "",
  hasDraftPayload = false,
  isControlling = false,
  isDictating = false,
  isSelecting = false,
  isSendingReply = false,
  threadBusy: busy = false,
  threadId = ""
} = {}) {
  return Boolean(
    threadId &&
      hasDraftPayload &&
      !isSendingReply &&
      !isSelecting &&
      !isControlling &&
      !isDictating &&
      !busy &&
      (!blockedReason || controlClaimRequired(blockedReason))
  );
}

export function defaultComposerStatus({
  blockedReason = "",
  composerStatus = "Ready",
  composerStatusTone = "neutral",
  controlActive = false,
  hasDraftPayload = false,
  isSendingReply = false,
  queuedCount = 0,
  threadBusy: busy = false
} = {}) {
  if (!isSendingReply && blockedReason && composerStatusTone === "neutral") {
    return blockedReason;
  }

  const queued = queueSummary(queuedCount);
  if (!isSendingReply && queued && composerStatusTone === "neutral") {
    return busy ? `${queued}. Waiting for idle.` : `${queued}. Sending soon.`;
  }

  if (!isSendingReply && !controlActive && composerStatusTone === "neutral" && hasDraftPayload) {
    return "Steer now takes control. Queue stays local.";
  }

  if (!isSendingReply && busy && composerStatusTone === "neutral") {
    return controlActive ? "Codex is busy. Queue your next steer." : "Codex is busy. Queue now; it will send when idle.";
  }

  return composerStatus;
}

export function controlReleaseStatus({ hasDraft = false } = {}) {
  return hasDraft ? "Remote control released. Draft kept." : "Remote control released.";
}

export function controlEventStatus({
  event = null,
  hasDraft = false,
  isLocalActor = false,
  queuedCount = 0
} = {}) {
  if (!event?.action) {
    return "";
  }

  const queued = queueSummary(queuedCount);

  if (event.action === "claim") {
    if (!isLocalActor) {
      return "";
    }

    if (queued) {
      return `Remote control reclaimed. ${queued}. Sending soon.`;
    }

    if (hasDraft) {
      return "Remote control active. Draft ready.";
    }

    return "Remote control active.";
  }

  if (event.action !== "release") {
    return "";
  }

  if (event.cause === "expired") {
    if (queued) {
      return `Remote control expired. ${queued}. Waiting for control.`;
    }

    return hasDraft ? "Remote control expired. Draft kept." : "Remote control expired.";
  }

  if (event.actor === "host") {
    if (queued) {
      return `Remote control released by host. ${queued}. Waiting for control.`;
    }

    return hasDraft ? "Remote control released by host. Draft kept." : "Remote control released by host.";
  }

  if (queued) {
    return `Remote control released. ${queued}. Waiting for control.`;
  }

  return controlReleaseStatus({ hasDraft });
}

export function controlReleaseFeedback({
  eventAction = "",
  hasDraft = false,
  isControlling = false,
  isSendingReply = false,
  previousHadRemoteControl = false,
  nextHasRemoteControl = false
} = {}) {
  if (isControlling || isSendingReply) {
    return "";
  }

  if (eventAction === "release") {
    return controlReleaseStatus({ hasDraft });
  }

  if (previousHadRemoteControl && !nextHasRemoteControl) {
    return controlReleaseStatus({ hasDraft });
  }

  return "";
}

export function shouldFlushQueuedReplies({
  blockedReason = "",
  hasInFlight = false,
  isSendingReply = false,
  queuedCount = 0,
  threadBusy: busy = false,
  threadId = ""
} = {}) {
  return Boolean(
    threadId &&
      queuedCount > 0 &&
      (!blockedReason || controlClaimRequired(blockedReason)) &&
      !busy &&
      !isSendingReply &&
      !hasInFlight
  );
}
