const KIB = 1024;

export const MOBILE_NETWORK_PROFILES = {
  "weak-mobile": {
    downstreamBytesPerSecond: 48 * KIB,
    dropSseAfterMs: null,
    jitterMs: 40,
    requestDelayMs: 180,
    responseDelayMs: 180,
    upstreamBytesPerSecond: 32 * KIB
  },
  "weak-mobile-reconnect": {
    downstreamBytesPerSecond: 48 * KIB,
    dropSseAfterMs: 3200,
    jitterMs: 50,
    requestDelayMs: 220,
    responseDelayMs: 220,
    upstreamBytesPerSecond: 32 * KIB
  }
};

export function resolveMobileNetworkProfile(name = "") {
  const key = String(name || "").trim().toLowerCase();
  if (!key) {
    return null;
  }
  return MOBILE_NETWORK_PROFILES[key] ? { name: key, ...MOBILE_NETWORK_PROFILES[key] } : null;
}

export function withNetworkJitter(baseMs, jitterMs = 0) {
  const base = Math.max(0, Number(baseMs) || 0);
  const jitter = Math.max(0, Number(jitterMs) || 0);
  if (jitter === 0) {
    return base;
  }
  const offset = Math.round((Math.random() * (jitter * 2)) - jitter);
  return Math.max(0, base + offset);
}

