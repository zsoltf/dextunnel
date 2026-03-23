export function nextBackoffDelay(currentMs, { baseMs, maxMs }) {
  const delay = Number.isFinite(currentMs) && currentMs > 0 ? currentMs : baseMs;
  return {
    delay,
    nextMs: Math.min(delay * 2, maxMs)
  };
}

export function shouldScheduleRetry({ hasTimer = false, isVisible = true } = {}) {
  return !hasTimer && Boolean(isVisible);
}

export function reconnectStreamState({ hasLiveState = false } = {}) {
  return hasLiveState ? "recovering" : "connecting";
}

export function planBootstrapRetry({
  backoffMs,
  baseMs,
  maxMs,
  hasTimer = false,
  isVisible = true
} = {}) {
  if (!shouldScheduleRetry({ hasTimer, isVisible })) {
    return {
      schedule: false
    };
  }

  const next = nextBackoffDelay(backoffMs, { baseMs, maxMs });
  return {
    delay: next.delay,
    nextBackoffMs: next.nextMs,
    schedule: true
  };
}

export function planStreamRecovery({
  backoffMs,
  baseMs,
  maxMs,
  hasLiveState = false,
  hasTimer = false,
  isVisible = true
} = {}) {
  if (!shouldScheduleRetry({ hasTimer, isVisible })) {
    return {
      schedule: false,
      streamState: reconnectStreamState({ hasLiveState })
    };
  }

  const next = nextBackoffDelay(backoffMs, { baseMs, maxMs });
  return {
    delay: next.delay,
    followupAction: hasLiveState ? "refresh" : "bootstrap",
    nextBackoffMs: next.nextMs,
    schedule: true,
    streamState: reconnectStreamState({ hasLiveState })
  };
}
