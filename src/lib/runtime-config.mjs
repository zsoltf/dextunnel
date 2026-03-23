import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function enabledFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function resolveRuntimeProfile(env = process.env) {
  return String(env.DEXTUNNEL_PROFILE || "default").trim().toLowerCase() === "dev" ? "dev" : "default";
}

function resolveCodexBinaryPath(env = process.env) {
  return (
    env.DEXTUNNEL_CODEX_BINARY ||
    env.CODEX_BINARY ||
    (existsSync("/Applications/Codex.app/Contents/Resources/codex")
      ? "/Applications/Codex.app/Contents/Resources/codex"
      : "codex")
  );
}

function parseFakeAgentRoomFailures(value) {
  const source = String(value || "").trim();
  if (!source) {
    return {};
  }

  const result = {};
  for (const rawEntry of source.split(",")) {
    const entry = String(rawEntry || "").trim();
    if (!entry) {
      continue;
    }

    const [participantRaw, modeRaw] = entry.split(":");
    const participantId = String(participantRaw || "").trim().toLowerCase();
    const rawSpec = String(modeRaw || "").trim().toLowerCase();
    if (!participantId || !rawSpec) {
      continue;
    }

    const match = rawSpec.match(/^(timeout|malformed|error)(?:\*(\d+))?$/);
    if (!match) {
      continue;
    }

    const mode = match[1];
    const count = Math.max(1, Number(match[2] || 1));
    if (!["timeout", "malformed", "error"].includes(mode)) {
      continue;
    }

    result[participantId] = { count, mode };
  }

  return result;
}

export function createRuntimeConfig({
  cwd = process.cwd(),
  env = process.env,
  importMetaUrl = import.meta.url
} = {}) {
  const runtimeProfile = resolveRuntimeProfile(env);
  const devToolsEnabled =
    runtimeProfile === "dev" || enabledFlag(env.DEXTUNNEL_ENABLE_DEVTOOLS);
  const useFakeAppServer = enabledFlag(env.DEXTUNNEL_FAKE_APP_SERVER);
  const fakeSendDelayMs = Number(env.DEXTUNNEL_FAKE_SEND_DELAY_MS || 0);
  const codexBinaryPath = resolveCodexBinaryPath(env);
  const appServerListenUrl = env.DEXTUNNEL_APP_SERVER_URL || "ws://127.0.0.1:4321";
  const exposeHostSurface = enabledFlag(env.DEXTUNNEL_EXPOSE_HOST_SURFACE);
  const host = String(env.DEXTUNNEL_HOST || "127.0.0.1").trim() || "127.0.0.1";
  const port = Number(env.PORT || 4317);
  const __dirname = path.dirname(fileURLToPath(importMetaUrl));
  const publicDir = path.join(__dirname, "..", "public");
  const attachmentDir = path.join(tmpdir(), "dextunnel-attachments");
  const agentRoomDir = path.join(cwd, ".agent", "artifacts", "runtime", "agent-room");
  const useFakeAgentRoom = enabledFlag(env.DEXTUNNEL_FAKE_AGENT_ROOM);
  const fakeAgentRoomFailures = parseFakeAgentRoomFailures(env.DEXTUNNEL_FAKE_AGENT_ROOM_FAILURES);

  return {
    agentRoomDir,
    appServerListenUrl,
    attachmentDir,
    codexBinaryPath,
    cwd,
    devToolsEnabled,
    exposeHostSurface,
    fakeAgentRoomFailures,
    fakeSendDelayMs,
    host,
    mimeTypes: {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    },
    port,
    publicDir,
    runtimeProfile,
    useFakeAgentRoom,
    useFakeAppServer
  };
}
