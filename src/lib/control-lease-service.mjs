export function createControlLeaseService({
  broadcast = () => {},
  buildLivePayload = () => ({}),
  clearControlLeaseState,
  defaultTtlMs,
  ensureRemoteControlLeaseState,
  getControlLeaseForThreadState,
  liveState,
  nowMs = () => Date.now(),
  recordControlEvent = () => {},
  renewControlLeaseState,
  setControlLeaseState,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  let controlLeaseTimer = null;

  function clearControlLease({
    actor = "system",
    actorClientId = null,
    broadcastUpdate = false,
    cause = "manual",
    recordEvent = false,
    threadId = null
  } = {}) {
    if (threadId && liveState.controlLease?.threadId && liveState.controlLease.threadId !== threadId) {
      return;
    }

    if (controlLeaseTimer) {
      clearTimeoutFn(controlLeaseTimer);
      controlLeaseTimer = null;
    }

    if (!liveState.controlLease) {
      return;
    }

    const previousLease = liveState.controlLease;
    liveState.controlLease = clearControlLeaseState(liveState.controlLease, { threadId, now: nowMs() });
    if (liveState.controlLease) {
      return;
    }

    if (recordEvent) {
      recordControlEvent({
        action: "release",
        actor,
        actorClientId,
        cause,
        owner: previousLease.owner || null,
        ownerClientId: previousLease.ownerClientId || null,
        ownerLabel: previousLease.ownerLabel || null,
        reason: previousLease.reason || null,
        source: previousLease.source || null,
        threadId: previousLease.threadId || threadId || null
      });
    }

    if (broadcastUpdate) {
      broadcast("live", buildLivePayload());
    }
  }

  function scheduleControlLeaseExpiry() {
    if (controlLeaseTimer) {
      clearTimeoutFn(controlLeaseTimer);
      controlLeaseTimer = null;
    }

    const lease = liveState.controlLease;
    if (!lease?.expiresAt) {
      return;
    }

    const delay = new Date(lease.expiresAt).getTime() - nowMs();
    if (delay <= 0) {
      clearControlLease({
        actor: "system",
        broadcastUpdate: true,
        cause: "expired",
        recordEvent: true,
        threadId: lease.threadId
      });
      return;
    }

    controlLeaseTimer = setTimeoutFn(() => {
      controlLeaseTimer = null;
      if (liveState.controlLease?.threadId === lease.threadId && liveState.controlLease?.expiresAt === lease.expiresAt) {
        clearControlLease({
          actor: "system",
          broadcastUpdate: true,
          cause: "expired",
          recordEvent: true,
          threadId: lease.threadId
        });
      }
    }, delay);
  }

  function setControlLease({
    clientId = null,
    owner = "remote",
    reason = "compose",
    source = "remote",
    threadId = liveState.selectedThreadId || null,
    ttlMs
  } = {}) {
    liveState.controlLease = setControlLeaseState({
      clientId,
      now: nowMs(),
      owner,
      reason,
      source,
      threadId,
      ttlMs: ttlMs ?? defaultTtlMs
    });
    scheduleControlLeaseExpiry();
    return liveState.controlLease;
  }

  function getControlLeaseForThread(threadId = null) {
    const lease = getControlLeaseForThreadState(liveState.controlLease, threadId, { now: nowMs() });
    if (!lease && liveState.controlLease?.expiresAt && new Date(liveState.controlLease.expiresAt).getTime() <= nowMs()) {
      clearControlLease({ threadId: liveState.controlLease.threadId });
      return null;
    }

    return lease;
  }

  function renewControlLease({
    clientId = null,
    owner = null,
    reason = null,
    source = null,
    threadId = liveState.selectedThreadId || null,
    ttlMs
  } = {}) {
    liveState.controlLease = renewControlLeaseState({
      clientId,
      lease: getControlLeaseForThread(threadId),
      now: nowMs(),
      owner,
      reason,
      source,
      threadId,
      ttlMs: ttlMs ?? defaultTtlMs
    });
    scheduleControlLeaseExpiry();
    return liveState.controlLease;
  }

  function getControlLeaseForSelectedThread() {
    return getControlLeaseForThread(liveState.selectedThreadId || null);
  }

  function ensureRemoteControlLease(threadId, source = "remote", clientId = null, ttlMs) {
    liveState.controlLease = ensureRemoteControlLeaseState({
      clientId,
      lease: liveState.controlLease,
      now: nowMs(),
      source,
      threadId,
      ttlMs: ttlMs ?? defaultTtlMs
    });
    scheduleControlLeaseExpiry();
  }

  return {
    clearControlLease,
    ensureRemoteControlLease,
    getControlLeaseForSelectedThread,
    getControlLeaseForThread,
    renewControlLease,
    scheduleControlLeaseExpiry,
    setControlLease
  };
}
