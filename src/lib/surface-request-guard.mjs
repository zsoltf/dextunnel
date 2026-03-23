function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

export function isLoopbackAddress(value) {
  const address = normalizeAddress(value);
  if (!address) {
    return false;
  }

  return (
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "127.0.0.1" ||
    address.startsWith("127.")
  );
}

export function canServeSurfaceBootstrap({
  exposeHostSurface = false,
  pathname = "",
  remoteAddress = ""
} = {}) {
  const nextPath = String(pathname || "").trim();
  if (nextPath !== "/host.html" && nextPath !== "host.html") {
    return true;
  }

  return Boolean(exposeHostSurface) || isLoopbackAddress(remoteAddress);
}
