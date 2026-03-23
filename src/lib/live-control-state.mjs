import {
  clearControlLease,
  ensureControlActionAllowed,
  renewControlLease,
  setControlLease
} from "./shared-room-state.mjs";

export function applyLiveControlAction({
  action = "claim",
  clientId = null,
  existingLease = null,
  owner = null,
  reason = null,
  source = "remote",
  threadId = null,
  ttlMs,
  now = Date.now()
} = {}) {
  const nextThreadId = String(threadId || "").trim();
  const nextClientId = String(clientId || "").trim() || null;
  const nextSource = source || "remote";

  if (!nextThreadId) {
    throw new Error("No live session selected.");
  }

  if (nextSource === "remote") {
    ensureControlActionAllowed({
      action,
      clientId: nextClientId,
      lease: existingLease,
      source: nextSource,
      threadId: nextThreadId,
      now
    });
  }

  if (action === "release") {
    const previousLease = existingLease || null;
    return {
      lease: clearControlLease(existingLease, { threadId: nextThreadId, now }),
      recordEvent: Boolean(previousLease),
      event: previousLease
        ? {
            action: "release",
            actor: nextSource,
            actorClientId: nextClientId,
            cause: "released",
            owner: previousLease.owner || null,
            ownerClientId: previousLease.ownerClientId || null,
            ownerLabel: previousLease.ownerLabel || null,
            reason: previousLease.reason || null,
            source: previousLease.source || null,
            threadId: previousLease.threadId || nextThreadId
          }
        : null
    };
  }

  if (action === "renew") {
    return {
      lease: renewControlLease({
        clientId: nextClientId,
        lease: existingLease,
        now,
        owner: owner || nextSource,
        reason,
        source: nextSource,
        threadId: nextThreadId,
        ttlMs
      }),
      recordEvent: false,
      event: null
    };
  }

  if (action === "claim") {
    const lease = setControlLease({
      clientId: nextClientId,
      now,
      owner: owner || nextSource,
      reason: reason || "compose",
      source: nextSource,
      threadId: nextThreadId,
      ttlMs
    });

    return {
      lease,
      recordEvent: true,
      event: {
        action: "claim",
        actor: nextSource,
        actorClientId: nextClientId,
        cause: "claimed",
        owner: lease.owner || null,
        ownerClientId: lease.ownerClientId || null,
        ownerLabel: lease.ownerLabel || null,
        reason: lease.reason || null,
        source: lease.source || null,
        threadId: lease.threadId || nextThreadId
      }
    };
  }

  throw new Error(`Unsupported control action: ${action}`);
}
