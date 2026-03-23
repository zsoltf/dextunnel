export function createSurfacePresenceService({
  appServerState,
  applySurfacePresenceUpdateState,
  buildSelectedAttachmentsState,
  countSurfacePresenceState,
  defaultStaleMs = null,
  liveState,
  normalizeSurfaceName,
  nowIso = () => new Date().toISOString(),
  pruneStaleSurfacePresenceState,
  randomId = () => `${Date.now()}`
} = {}) {
  function recordSurfaceEvent({ action, cause = "", surface = "", threadId = null } = {}) {
    const nextThreadId = String(threadId || "").trim();
    const nextAction = action === "attach" ? "attach" : action === "detach" ? "detach" : "";
    const nextSurface = normalizeSurfaceName(surface);
    if (!nextThreadId || !nextAction || !nextSurface) {
      return null;
    }

    const event = {
      action: nextAction,
      at: nowIso(),
      cause: String(cause || "").trim() || null,
      id: randomId(),
      surface: nextSurface,
      threadId: nextThreadId
    };
    appServerState.lastSurfaceEvent = event;
    return event;
  }

  function pruneStaleSurfacePresence({ now = Date.now(), staleMs = defaultStaleMs } = {}) {
    if (!Number.isFinite(staleMs)) {
      return false;
    }

    const result = pruneStaleSurfacePresenceState(liveState.surfacePresenceByClientId, {
      now,
      staleMs
    });

    if (result.changed) {
      liveState.surfacePresenceByClientId = result.nextPresenceByClientId;
      for (const event of result.events) {
        recordSurfaceEvent(event);
      }
    }

    return result.changed;
  }

  function countSurfacePresence(threadId, surface) {
    return countSurfacePresenceState(liveState.surfacePresenceByClientId, threadId, surface);
  }

  function applySurfacePresenceUpdate(payload = {}, { now = Date.now(), selectedThreadId = "" } = {}) {
    const result = applySurfacePresenceUpdateState(liveState.surfacePresenceByClientId, payload, {
      now,
      selectedThreadId
    });

    if (result.changed) {
      liveState.surfacePresenceByClientId = result.nextPresenceByClientId;
      for (const event of result.events) {
        recordSurfaceEvent(event);
      }
    }

    return result.changed;
  }

  function upsertSurfacePresence(payload = {}, { now = Date.now(), selectedThreadId = liveState.selectedThreadId || "" } = {}) {
    pruneStaleSurfacePresence({ now });
    return applySurfacePresenceUpdate(
      {
        ...payload,
        detach: false,
        threadId: payload.threadId || liveState.selectedThreadId || ""
      },
      {
        now,
        selectedThreadId
      }
    );
  }

  function removeSurfacePresence(clientId, { now = Date.now(), selectedThreadId = liveState.selectedThreadId || "" } = {}) {
    return applySurfacePresenceUpdate(
      {
        clientId,
        detach: true
      },
      {
        now,
        selectedThreadId
      }
    );
  }

  function buildSelectedAttachments(
    threadId = liveState.selectedThreadId || liveState.selectedThreadSnapshot?.thread?.id || null,
    { now = Date.now(), staleMs = defaultStaleMs } = {}
  ) {
    pruneStaleSurfacePresence({ now, staleMs });
    return buildSelectedAttachmentsState(liveState.surfacePresenceByClientId, threadId);
  }

  return {
    applySurfacePresenceUpdate,
    buildSelectedAttachments,
    countSurfacePresence,
    pruneStaleSurfacePresence,
    recordSurfaceEvent,
    removeSurfacePresence,
    upsertSurfacePresence
  };
}
