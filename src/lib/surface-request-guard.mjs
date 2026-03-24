function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeComparableAddress(value) {
  const address = normalizeAddress(value);
  if (address.startsWith("::ffff:")) {
    return address.slice(7);
  }
  return address;
}

export function isLoopbackAddress(value) {
  const address = normalizeComparableAddress(value);
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

export function isSameMachineAddress(remoteAddress, localAddress) {
  const remote = normalizeComparableAddress(remoteAddress);
  const local = normalizeComparableAddress(localAddress);
  if (!remote || !local) {
    return false;
  }
  return remote === local;
}

export function canServeSurfaceBootstrap({
  exposeHostSurface = false,
  localAddress = "",
  pathname = "",
  remoteAddress = ""
} = {}) {
  const nextPath = String(pathname || "").trim();
  if (nextPath !== "/host.html" && nextPath !== "host.html") {
    return true;
  }

  return (
    Boolean(exposeHostSurface) ||
    isLoopbackAddress(remoteAddress) ||
    isSameMachineAddress(remoteAddress, localAddress)
  );
}
