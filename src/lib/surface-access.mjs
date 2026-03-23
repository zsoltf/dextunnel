import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeSurfaceName } from "./shared-room-state.mjs";

export const DEFAULT_SURFACE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const SURFACE_CAPABILITIES = {
  host: [
    "read_room",
    "select_room",
    "sync_presence",
    "refresh_room",
    "open_in_codex",
    "respond_interaction",
    "release_remote_control",
    "debug_tools"
  ],
  remote: [
    "read_room",
    "select_room",
    "sync_presence",
    "refresh_room",
    "open_in_codex",
    "respond_interaction",
    "control_remote",
    "send_turn",
    "use_companion",
    "use_agent_room"
  ]
};

export function defaultSurfaceAccessSecretPath({ cwd = process.cwd() } = {}) {
  return path.join(cwd, ".agent", "artifacts", "runtime", "surface-access-secret.txt");
}

function signatureFor(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodePayload(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodePayload(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function surfaceAccessError(message, statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function loadOrCreateSurfaceAccessSecret({
  secretPath = defaultSurfaceAccessSecretPath()
} = {}) {
  try {
    const existing = (await readFile(secretPath, "utf8")).trim();
    if (existing) {
      return existing;
    }
  } catch {}

  const secret = randomBytes(32).toString("base64url");
  await mkdir(path.dirname(secretPath), { recursive: true });
  await writeFile(secretPath, `${secret}\n`, "utf8");
  return secret;
}

export function createSurfaceAccessRegistry({
  now = () => new Date().toISOString(),
  nowMs = () => Date.now(),
  ttlMs = DEFAULT_SURFACE_TOKEN_TTL_MS,
  secret
} = {}) {
  if (!secret) {
    throw new Error("createSurfaceAccessRegistry requires a signing secret.");
  }

  function issueBootstrap(surface = "remote") {
    const nextSurface = normalizeSurfaceName(surface);
    const capabilities = SURFACE_CAPABILITIES[nextSurface];
    if (!capabilities) {
      throw surfaceAccessError(`Unsupported surface: ${surface}`, 400);
    }

    const payload = {
      clientId: `${nextSurface}-${randomBytes(10).toString("base64url")}`,
      issuedAt: now(),
      expiresAt: new Date(nowMs() + ttlMs).toISOString(),
      nonce: randomBytes(12).toString("base64url"),
      surface: nextSurface
    };
    const encoded = encodePayload(payload);
    const signature = signatureFor(secret, encoded);

    return {
      accessToken: `${encoded}.${signature}`,
      capabilities: [...capabilities],
      clientId: payload.clientId,
      expiresAt: payload.expiresAt,
      issuedAt: payload.issuedAt,
      surface: payload.surface
    };
  }

  function resolve({ headers = {}, searchParams = null } = {}) {
    const headerToken = String(headers["x-dextunnel-surface-token"] || "").trim();
    const queryToken = String(searchParams?.get?.("surfaceToken") || "").trim();
    const token = headerToken || queryToken;
    if (!token || !token.includes(".")) {
      return null;
    }

    const [encoded, signature] = token.split(".", 2);
    if (!encoded || !signature) {
      return null;
    }

    const expected = signatureFor(secret, encoded);
    if (signature !== expected) {
      return null;
    }

    let payload = null;
    try {
      payload = decodePayload(encoded);
    } catch {
      return null;
    }

    const surface = normalizeSurfaceName(payload.surface);
    const capabilities = SURFACE_CAPABILITIES[surface];
    if (!capabilities) {
      return null;
    }
    if (payload.expiresAt && new Date(payload.expiresAt).getTime() <= nowMs()) {
      return null;
    }

    return {
      accessToken: token,
      capabilities: [...capabilities],
      clientId: String(payload.clientId || "").trim() || null,
      expiresAt: payload.expiresAt || null,
      issuedAt: payload.issuedAt || null,
      surface
    };
  }

  function requireCapability({ capability, headers = {}, searchParams = null } = {}) {
    const access = resolve({ headers, searchParams });
    if (!access) {
      throw surfaceAccessError("Dextunnel surface access is missing or expired.");
    }
    if (!access.capabilities.includes(capability)) {
      throw surfaceAccessError(
        `${access.surface} surface is not allowed to ${capability.replaceAll("_", " ")}.`
      );
    }
    return access;
  }

  return {
    issueBootstrap,
    requireCapability,
    resolve
  };
}

export function injectSurfaceBootstrap(html, bootstrap) {
  const script = `<script>window.__DEXTUNNEL_SURFACE_BOOTSTRAP__ = ${JSON.stringify(bootstrap)};</script>`;
  return html.includes("</body>")
    ? html.replace("</body>", `    ${script}\n  </body>`)
    : `${html}\n${script}\n`;
}
