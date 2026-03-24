function isoAt(nowMs) {
  return new Date(nowMs).toISOString();
}

export function normalizeSurfaceName(value) {
  const nextSurface = String(value || "").trim().toLowerCase();
  if (nextSurface === "host" || nextSurface === "agent" || nextSurface === "remote") {
    return nextSurface;
  }
  return "remote";
}

function isWriterSurface(surface) {
  const nextSurface = normalizeSurfaceName(surface);
  return nextSurface === "remote" || nextSurface === "agent";
}

export function shortClientId(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!normalized) {
    return "";
  }

  return normalized.length > 4 ? normalized.slice(-4) : normalized;
}

export function surfaceActorLabel({ surface = "", clientId = null } = {}) {
  const nextSurface = normalizeSurfaceName(surface);
  const base =
    nextSurface === "host"
      ? "Host"
      : nextSurface === "agent"
        ? "Agent"
        : "Remote";
  const suffix = shortClientId(clientId);
  return suffix ? `${base} ${suffix}` : base;
}

export function countSurfacePresence(surfacePresenceByClientId = {}, threadId, surface) {
  const nextThreadId = String(threadId || "").trim();
  const nextSurface = normalizeSurfaceName(surface);
  if (!nextThreadId || !nextSurface) {
    return 0;
  }

  let count = 0;
  for (const presence of Object.values(surfacePresenceByClientId || {})) {
    if (!presence?.threadId || presence.threadId !== nextThreadId) {
      continue;
    }

    if (normalizeSurfaceName(presence.surface) !== nextSurface) {
      continue;
    }

    count += 1;
  }

  return count;
}

export function surfacePresenceState(presence) {
  if (!presence) {
    return "detached";
  }

  if (presence.visible && presence.focused && presence.engaged) {
    return "active";
  }

  if (presence.visible && presence.focused) {
    return "open";
  }

  if (presence.visible) {
    return "viewing";
  }

  return "background";
}

export function upsertSurfacePresence(surfacePresenceByClientId = {}, payload = {}, { updatedAt = isoAt(Date.now()) } = {}) {
  const clientId = String(payload.clientId || "").trim();
  const threadId = String(payload.threadId || "").trim();
  if (!clientId || !threadId) {
    return {
      changed: false,
      nextPresenceByClientId: surfacePresenceByClientId,
      nextPresence: null,
      previousPresence: null
    };
  }

  const nextPresence = {
    clientId,
    engaged: Boolean(payload.engaged),
    focused: Boolean(payload.focused),
    label: normalizeSurfaceName(payload.surface),
    surface: normalizeSurfaceName(payload.surface),
    threadId,
    updatedAt,
    visible: payload.visible !== false
  };
  const previousPresence = surfacePresenceByClientId[clientId] || null;

  const changed =
    !previousPresence ||
    previousPresence.surface !== nextPresence.surface ||
    previousPresence.threadId !== nextPresence.threadId ||
    previousPresence.visible !== nextPresence.visible ||
    previousPresence.focused !== nextPresence.focused ||
    previousPresence.engaged !== nextPresence.engaged;

  if (!changed) {
    return {
      changed: false,
      nextPresenceByClientId: surfacePresenceByClientId,
      nextPresence,
      previousPresence
    };
  }

  return {
    changed: true,
    nextPresence,
    nextPresenceByClientId: {
      ...surfacePresenceByClientId,
      [clientId]: nextPresence
    },
    previousPresence
  };
}

export function removeSurfacePresence(surfacePresenceByClientId = {}, clientId) {
  const id = String(clientId || "").trim();
  const previousPresence = id ? surfacePresenceByClientId[id] || null : null;
  if (!id || !previousPresence) {
    return {
      changed: false,
      nextPresenceByClientId: surfacePresenceByClientId,
      previousPresence: null
    };
  }

  const nextPresenceByClientId = {
    ...surfacePresenceByClientId
  };
  delete nextPresenceByClientId[id];

  return {
    changed: true,
    nextPresenceByClientId,
    previousPresence
  };
}

export function applySurfacePresenceUpdate(
  surfacePresenceByClientId = {},
  payload = {},
  { now = Date.now(), selectedThreadId = "" } = {}
) {
  const updatedAt = isoAt(now);
  const clientId = String(payload.clientId || "").trim();
  const previousPresence = clientId ? surfacePresenceByClientId[clientId] || null : null;
  const previousThreadId = String(previousPresence?.threadId || "").trim();
  const previousSurface = normalizeSurfaceName(previousPresence?.surface);
  const previousCount =
    previousThreadId && previousSurface
      ? countSurfacePresence(surfacePresenceByClientId, previousThreadId, previousSurface)
      : 0;
  const nextThreadId = String(payload.threadId || selectedThreadId || "").trim();
  const nextSurface = normalizeSurfaceName(payload.surface);
  const nextCountBefore =
    !payload.detach && nextThreadId && nextSurface
      ? countSurfacePresence(surfacePresenceByClientId, nextThreadId, nextSurface)
      : 0;

  const updateResult = payload.detach
    ? removeSurfacePresence(surfacePresenceByClientId, payload.clientId)
    : upsertSurfacePresence(surfacePresenceByClientId, { ...payload, threadId: nextThreadId }, { updatedAt });

  const events = [];

  if (updateResult.changed) {
    if (payload.detach) {
      if (previousThreadId && previousSurface && previousCount === 1) {
        events.push({
          action: "detach",
          at: updatedAt,
          cause: "closed",
          surface: previousSurface,
          threadId: previousThreadId
        });
      }
    } else {
      if (
        previousPresence &&
        previousThreadId &&
        previousSurface &&
        (previousThreadId !== nextThreadId || previousSurface !== nextSurface) &&
        previousCount === 1
      ) {
        events.push({
          action: "detach",
          at: updatedAt,
          cause: "moved",
          surface: previousSurface,
          threadId: previousThreadId
        });
      }

      if (nextThreadId && nextSurface) {
        const nextCountAfter = countSurfacePresence(updateResult.nextPresenceByClientId, nextThreadId, nextSurface);
        if (nextCountBefore === 0 && nextCountAfter > 0) {
          events.push({
            action: "attach",
            at: updatedAt,
            cause: previousPresence ? "moved" : "opened",
            surface: nextSurface,
            threadId: nextThreadId
          });
        }
      }
    }
  }

  return {
    changed: updateResult.changed,
    events,
    nextPresenceByClientId: updateResult.nextPresenceByClientId,
    nextPresence: updateResult.nextPresence || null,
    previousPresence: updateResult.previousPresence || null
  };
}

export function pruneStaleSurfacePresence(surfacePresenceByClientId = {}, { now = Date.now(), staleMs = 0 } = {}) {
  const current = surfacePresenceByClientId || {};
  let changed = false;
  const nextPresenceByClientId = {};
  const events = [];

  for (const [clientId, presence] of Object.entries(current)) {
    const updatedAtMs = new Date(presence.updatedAt || 0).getTime();
    if (!updatedAtMs || now - updatedAtMs > staleMs) {
      const threadId = String(presence?.threadId || "").trim();
      const surface = normalizeSurfaceName(presence?.surface);
      if (threadId && countSurfacePresence(current, threadId, surface) === 1) {
        events.push({
          action: "detach",
          at: isoAt(now),
          cause: "stale",
          surface,
          threadId
        });
      }
      changed = true;
      continue;
    }

    nextPresenceByClientId[clientId] = presence;
  }

  return {
    changed,
    events,
    nextPresenceByClientId: changed ? nextPresenceByClientId : current
  };
}

export function buildSelectedAttachments(surfacePresenceByClientId = {}, threadId = null) {
  const nextThreadId = String(threadId || "").trim();
  if (!nextThreadId) {
    return [];
  }

  const grouped = new Map();
  for (const presence of Object.values(surfacePresenceByClientId || {})) {
    if (!presence?.threadId || presence.threadId !== nextThreadId) {
      continue;
    }

    const surface = normalizeSurfaceName(presence.surface);
    const current = grouped.get(surface);
    if (!current) {
      grouped.set(surface, {
        count: 1,
        label: surface,
        state: surfacePresenceState(presence),
        surface,
        updatedAt: presence.updatedAt || null
      });
      continue;
    }

    const currentUpdatedAtMs = new Date(current.updatedAt || 0).getTime();
    const nextUpdatedAtMs = new Date(presence.updatedAt || 0).getTime();
    grouped.set(surface, {
      ...current,
      count: current.count + 1,
      state: nextUpdatedAtMs >= currentUpdatedAtMs ? surfacePresenceState(presence) : current.state,
      updatedAt: nextUpdatedAtMs >= currentUpdatedAtMs ? presence.updatedAt || null : current.updatedAt
    });
  }

  return [...grouped.values()]
    .sort((a, b) => {
      const order = { remote: 10, host: 20 };
      const delta = (order[a.surface] || 99) - (order[b.surface] || 99);
      if (delta !== 0) {
        return delta;
      }
      return String(a.label || "").localeCompare(String(b.label || ""));
    })
    .map(({ updatedAt: _updatedAt, ...attachment }) => attachment);
}

export function setControlLease({
  clientId = null,
  owner = "remote",
  reason = "compose",
  source = "remote",
  threadId = null,
  ttlMs,
  now = Date.now()
} = {}) {
  if (!threadId) {
    throw new Error("No live session selected.");
  }

  return {
    acquiredAt: isoAt(now),
    expiresAt: isoAt(now + ttlMs),
    ownerClientId: clientId ? String(clientId).trim() : null,
    ownerLabel: surfaceActorLabel({ surface: owner || source, clientId }),
    owner,
    reason,
    source,
    threadId
  };
}

export function getControlLeaseForThread(lease, threadId = null, { now = Date.now() } = {}) {
  if (!lease) {
    return null;
  }

  if (lease.expiresAt && new Date(lease.expiresAt).getTime() <= now) {
    return null;
  }

  if (threadId && lease.threadId !== threadId) {
    return null;
  }

  return lease;
}

export function clearControlLease(lease, { threadId = null, now = Date.now() } = {}) {
  const current = getControlLeaseForThread(lease, null, { now });
  if (!current) {
    return null;
  }

  if (threadId && current.threadId !== threadId) {
    return current;
  }

  return null;
}

export function renewControlLease({
  lease,
  clientId = null,
  owner = null,
  reason = null,
  source = null,
  threadId = null,
  ttlMs,
  now = Date.now()
} = {}) {
  const current = getControlLeaseForThread(lease, threadId, { now });
  if (!current) {
    throw new Error("Remote control is not active.");
  }

  const nextClientId = clientId ? String(clientId).trim() : current.ownerClientId || null;
  const nextOwner = owner || current.owner || "remote";
  const nextSource = source || current.source || "remote";

  return {
    ...current,
    expiresAt: isoAt(now + ttlMs),
    ownerClientId: nextClientId,
    ownerLabel: surfaceActorLabel({
      surface: nextOwner || nextSource,
      clientId: nextClientId
    }),
    owner: nextOwner,
    reason: reason || current.reason || "compose",
    source: nextSource
  };
}

export function ensureControlActionAllowed({
  action = "claim",
  lease,
  threadId,
  source = "remote",
  clientId = null,
  now = Date.now()
} = {}) {
  const current = getControlLeaseForThread(lease, threadId, { now });
  const nextSource = normalizeSurfaceName(source);
  if (!current || !isWriterSurface(nextSource)) {
    return current;
  }

  const nextClientId = String(clientId || "").trim();
  const currentOwner = normalizeSurfaceName(current.owner || current.source || "");
  const currentOwnerLabel =
    current.ownerLabel || surfaceActorLabel({ surface: current.owner || current.source, clientId: current.ownerClientId });

  if (currentOwner === nextSource) {
    if (nextClientId && current.ownerClientId && current.ownerClientId === nextClientId) {
      return current;
    }

    throw new Error(`Another ${nextSource} surface currently holds control for this channel.`);
  }

  throw new Error(`${currentOwnerLabel} currently holds control for this channel.`);
}

export function ensureRemoteControlLease({
  lease,
  threadId,
  source = "remote",
  clientId = null,
  ttlMs,
  now = Date.now()
} = {}) {
  ensureControlActionAllowed({
    action: "renew",
    lease,
    threadId,
    source,
    clientId,
    now
  });
  const current = getControlLeaseForThread(lease, threadId, { now });
  const nextSource = normalizeSurfaceName(source);
  if (!current || current.owner !== source) {
    throw new Error(`Take control before sending from the ${nextSource}.`);
  }

  const nextClientId = String(clientId || "").trim();
  if (nextClientId && current.ownerClientId && current.ownerClientId !== nextClientId) {
    throw new Error(`Another ${nextSource} surface currently holds control for this channel.`);
  }

  return renewControlLease({
    clientId: nextClientId || current.ownerClientId || null,
    lease: current,
    now,
    owner: current.owner,
    reason: current.reason || "compose",
    source: current.source || source,
    threadId,
    ttlMs
  });
}
