import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function workspaceLabel(cwd) {
  const parts = String(cwd || "")
    .split("/")
    .filter(Boolean);
  return parts.length ? parts.slice(-2).join("/") : cwd || "this workspace";
}

function localBaseUrl(host, port) {
  const normalizedHost = String(host || "127.0.0.1").trim() || "127.0.0.1";
  const displayHost = normalizedHost === "0.0.0.0" ? "127.0.0.1" : normalizedHost;
  return `http://${displayHost}:${port}`;
}

function normalizeStartupError(message, binaryPath) {
  const text = String(message || "").trim();
  if (!text) {
    return "";
  }

  if (/ENOENT/i.test(text)) {
    return `Could not launch Codex from ${binaryPath}. Install Codex or set DEXTUNNEL_CODEX_BINARY.`;
  }

  if (/Timed out waiting for codex app-server readiness\./i.test(text)) {
    return "Codex was found, but app-server did not become ready in time.";
  }

  return text;
}

export function resolveCodexBinary(
  binaryPath,
  {
    accessSyncImpl = accessSync,
    spawnSyncImpl = spawnSync
  } = {}
) {
  const configuredPath = String(binaryPath || "").trim();
  if (!configuredPath) {
    return {
      configuredPath: "",
      error: "No Codex binary is configured.",
      found: false,
      resolvedPath: null,
      source: "missing"
    };
  }

  const explicitPath = configuredPath.includes("/") || configuredPath.startsWith(".");
  if (explicitPath) {
    try {
      accessSyncImpl(configuredPath, constants.X_OK);
      return {
        configuredPath,
        error: null,
        found: true,
        resolvedPath: configuredPath,
        source: "explicit"
      };
    } catch {
      return {
        configuredPath,
        error: `Configured Codex binary is not executable: ${configuredPath}`,
        found: false,
        resolvedPath: null,
        source: "explicit"
      };
    }
  }

  const locator = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSyncImpl(locator, [configuredPath], {
      encoding: "utf8"
    });
    const resolvedPath = String(result?.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null;
    if (result?.status === 0 && resolvedPath) {
      return {
        configuredPath,
        error: null,
        found: true,
        resolvedPath,
        source: "path"
      };
    }
  } catch {
    // Fall through to the consistent not-found payload.
  }

  return {
    configuredPath,
    error: `Could not find '${configuredPath}' on PATH.`,
    found: false,
    resolvedPath: null,
    source: "path"
  };
}

export async function checkReadyUrl(
  readyUrl,
  {
    fetchImpl = fetch,
    timeoutMs = 1500
  } = {}
) {
  const target = String(readyUrl || "").trim();
  if (!target) {
    return {
      error: "No app-server readiness URL is configured.",
      ok: false,
      statusCode: null
    };
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(target, {
      method: "GET",
      signal: controller?.signal
    });
    return {
      error: response.ok ? null : `Codex app-server readiness returned HTTP ${response.status}.`,
      ok: response.ok,
      statusCode: response.status
    };
  } catch (error) {
    return {
      error:
        error?.name === "AbortError"
          ? "Timed out waiting for Codex app-server readiness."
          : String(error?.message || error || "Unknown readiness failure."),
      ok: false,
      statusCode: null
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function buildNextSteps({
  appServerHealthy,
  baseUrl,
  binary,
  host,
  workspace
}) {
  if (!binary.found) {
    return [
      "Install Codex locally or set DEXTUNNEL_CODEX_BINARY to the Codex CLI path.",
      "Run npm run doctor again once Codex is available.",
      `Then open ${baseUrl}/ to confirm the local preflight.`
    ];
  }

  if (!appServerHealthy) {
    return [
      "Make sure the configured Codex binary can launch app-server on this machine.",
      "If Codex is installed elsewhere, set DEXTUNNEL_CODEX_BINARY to the full executable path.",
      "Run npm run doctor again after fixing the Codex binary path."
    ];
  }

  if (workspace.hasThreadForCwd === false) {
    return [
      `Open Codex in ${workspace.label} once so Dextunnel has a thread to follow.`,
      "Refresh this page or rerun npm run doctor after the thread appears.",
      `Then open ${baseUrl}/remote.html.`
    ];
  }

  return [
    `Open ${baseUrl}/remote.html.`,
    host === "127.0.0.1"
      ? "Use npm run start:network when you want phone or tablet access over LAN or Tailscale."
      : "This server is already bound beyond loopback for another device on your local network.",
    "Run npm run doctor any time you want to re-check the local setup."
  ];
}

function buildSummary({
  appServerHealthy,
  binary,
  workspace
}) {
  if (!binary.found) {
    return "Dextunnel cannot find a usable Codex binary yet.";
  }

  if (!appServerHealthy) {
    return "Dextunnel found Codex, but app-server is not ready yet.";
  }

  if (workspace.hasThreadForCwd === false) {
    return "Codex is reachable, but this workspace does not have a visible thread yet.";
  }

  if (workspace.cwdThreadCount > 0) {
    return `Dextunnel is ready. Found ${pluralize(workspace.cwdThreadCount, "thread")} for ${workspace.label}.`;
  }

  return "Dextunnel is ready. Open the remote and pick a live Codex thread.";
}

function buildChecks({
  appServer,
  appServerHealthy,
  binary,
  host,
  runtimeProfile,
  workspace
}) {
  return [
    {
      detail: binary.found
        ? `Using ${binary.resolvedPath || binary.configuredPath}.`
        : binary.error,
      id: "binary",
      label: "Codex binary",
      severity: binary.found ? "ready" : "error"
    },
    {
      detail: appServerHealthy
        ? `Ready at ${appServer.readyUrl}.`
        : appServer.error || "Codex app-server is not reachable yet.",
      id: "app-server",
      label: "Codex app-server",
      severity: appServerHealthy ? "ready" : "error"
    },
    {
      detail:
        workspace.hasThreadForCwd === null
          ? `Checking ${workspace.label}...`
          : workspace.hasThreadForCwd
            ? `${pluralize(workspace.cwdThreadCount, "thread")} visible for ${workspace.label}.`
            : `No visible Codex thread for ${workspace.label} yet.`,
      id: "workspace",
      label: "Current workspace",
      severity:
        workspace.hasThreadForCwd === null
          ? "warning"
          : workspace.hasThreadForCwd
            ? "ready"
            : "warning"
    },
    {
      detail:
        host === "127.0.0.1"
          ? "Loopback-only by default. Use npm run start:network for phone or tablet access."
          : `Bound on ${host} for another device on your local network.`,
      id: "access",
      label: "Access mode",
      severity: "ready"
    },
    {
      detail: `Using the ${runtimeProfile} runtime profile.`,
      id: "profile",
      label: "Runtime profile",
      severity: "ready"
    }
  ];
}

export async function buildInstallPreflight({
  codexAppServer,
  cwd = process.cwd(),
  runtimeConfig = {},
  warmup = true,
  checkReady = checkReadyUrl,
  resolveBinary = resolveCodexBinary
} = {}) {
  if (!codexAppServer?.getStatus || !codexAppServer?.listThreads) {
    throw new Error("buildInstallPreflight requires a Codex app-server bridge.");
  }

  const bridgeStatusBefore = codexAppServer.getStatus();
  const binary = resolveBinary(runtimeConfig.codexBinaryPath || bridgeStatusBefore.binaryPath || "");

  let threads = null;
  let warmupError = "";
  if (warmup) {
    try {
      threads = await codexAppServer.listThreads({
        archived: false,
        limit: 50
      });
    } catch (error) {
      warmupError = normalizeStartupError(error?.message, binary.configuredPath || bridgeStatusBefore.binaryPath || "codex");
    }
  }

  const bridgeStatus = codexAppServer.getStatus();
  const ready = await checkReady(bridgeStatus.readyUrl);
  const appServerHealthy = Boolean(ready.ok || threads);
  const workspaceThreads = Array.isArray(threads)
    ? threads.filter((thread) => thread?.cwd === cwd)
    : null;
  const workspace = {
    cwd,
    cwdThreadCount: workspaceThreads?.length ?? null,
    hasThreadForCwd: workspaceThreads == null ? null : workspaceThreads.length > 0,
    label: workspaceLabel(cwd),
    threadCount: Array.isArray(threads) ? threads.length : null
  };
  const appServer = {
    error:
      normalizeStartupError(bridgeStatus.lastError, binary.configuredPath || bridgeStatus.binaryPath || "codex") ||
      warmupError ||
      ready.error ||
      null,
    healthy: appServerHealthy,
    lastError: bridgeStatus.lastError || null,
    listenUrl: bridgeStatus.listenUrl || runtimeConfig.appServerListenUrl || "",
    pid: bridgeStatus.pid || null,
    ready: Boolean(ready.ok),
    readyUrl: bridgeStatus.readyUrl || "",
    started: Boolean(bridgeStatus.started),
    startupLogTail: Array.isArray(bridgeStatus.startupLogs) ? bridgeStatus.startupLogs.slice(-4) : [],
    warmupAttempted: Boolean(warmup),
    warmupOk: Array.isArray(threads)
  };
  const baseUrl = localBaseUrl(runtimeConfig.host || "127.0.0.1", runtimeConfig.port || 4317);
  const status = !binary.found || !appServerHealthy ? "error" : workspace.hasThreadForCwd ? "ready" : "warning";

  return {
    appServer,
    checks: buildChecks({
      appServer,
      appServerHealthy,
      binary,
      host: runtimeConfig.host || "127.0.0.1",
      runtimeProfile: runtimeConfig.runtimeProfile || "default",
      workspace
    }),
    codexBinary: binary,
    nextSteps: buildNextSteps({
      appServerHealthy,
      baseUrl,
      binary,
      host: runtimeConfig.host || "127.0.0.1",
      workspace
    }),
    runtime: {
      appServerListenUrl: runtimeConfig.appServerListenUrl || bridgeStatus.listenUrl || "",
      baseUrl,
      host: runtimeConfig.host || "127.0.0.1",
      port: runtimeConfig.port || 4317,
      runtimeProfile: runtimeConfig.runtimeProfile || "default"
    },
    status,
    summary: buildSummary({
      appServerHealthy,
      binary,
      workspace
    }),
    workspace
  };
}
