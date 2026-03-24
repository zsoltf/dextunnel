import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInstallPreflight,
  resolveCodexBinary
} from "../src/lib/install-preflight.mjs";

test("resolveCodexBinary keeps explicit executable paths when they are usable", () => {
  const result = resolveCodexBinary("/Applications/Codex.app/Contents/Resources/codex", {
    accessSyncImpl() {}
  });

  assert.equal(result.found, true);
  assert.equal(result.resolvedPath, "/Applications/Codex.app/Contents/Resources/codex");
  assert.equal(result.error, null);
});

test("buildInstallPreflight reports ready when Codex and workspace threads are healthy", async () => {
  const payload = await buildInstallPreflight({
    codexAppServer: {
      getStatus() {
        return {
          binaryPath: "/Applications/Codex.app/Contents/Resources/codex",
          lastError: null,
          listenUrl: "ws://127.0.0.1:4321",
          pid: 1234,
          readyUrl: "http://127.0.0.1:4321/readyz",
          started: true,
          startupLogs: ["ready"]
        };
      },
      async listThreads() {
        return [
          { cwd: "/tmp/dextunnel", id: "thr_1" },
          { cwd: "/tmp/other", id: "thr_2" }
        ];
      }
    },
    cwd: "/tmp/dextunnel",
    runtimeConfig: {
      appServerListenUrl: "ws://127.0.0.1:4321",
      codexBinaryPath: "/Applications/Codex.app/Contents/Resources/codex",
      host: "127.0.0.1",
      port: 4317,
      runtimeProfile: "default"
    },
    resolveBinary: () => ({
      configuredPath: "/Applications/Codex.app/Contents/Resources/codex",
      error: null,
      found: true,
      resolvedPath: "/Applications/Codex.app/Contents/Resources/codex",
      source: "explicit"
    }),
    checkReady: async () => ({
      error: null,
      ok: true,
      statusCode: 200
    })
  });

  assert.equal(payload.status, "ready");
  assert.equal(payload.workspace.cwdThreadCount, 1);
  assert.equal(payload.appServer.healthy, true);
  assert.equal(payload.links.manifest, "http://127.0.0.1:4317/.well-known/dextunnel.json");
  assert.equal(payload.links.openapi, "http://127.0.0.1:4317/openapi.json");
  assert.match(payload.summary, /Dextunnel is ready/i);
  assert.equal(payload.nextSteps[0], "Open http://127.0.0.1:4317/.");
});

test("buildInstallPreflight reports warning when Codex is healthy but the workspace has no thread yet", async () => {
  const payload = await buildInstallPreflight({
    codexAppServer: {
      getStatus() {
        return {
          binaryPath: "codex",
          lastError: null,
          listenUrl: "ws://127.0.0.1:4321",
          readyUrl: "http://127.0.0.1:4321/readyz",
          started: true,
          startupLogs: []
        };
      },
      async listThreads() {
        return [{ cwd: "/tmp/other", id: "thr_2" }];
      }
    },
    cwd: "/tmp/dextunnel",
    runtimeConfig: {
      appServerListenUrl: "ws://127.0.0.1:4321",
      codexBinaryPath: "codex",
      host: "127.0.0.1",
      port: 4317,
      runtimeProfile: "default"
    },
    resolveBinary: () => ({
      configuredPath: "codex",
      error: null,
      found: true,
      resolvedPath: "/usr/local/bin/codex",
      source: "path"
    }),
    checkReady: async () => ({
      error: null,
      ok: true,
      statusCode: 200
    })
  });

  assert.equal(payload.status, "warning");
  assert.equal(payload.workspace.hasThreadForCwd, false);
  assert.match(payload.summary, /does not have a visible thread yet/i);
  assert.match(payload.nextSteps[0], /Open Codex in tmp\/dextunnel once/i);
});

test("buildInstallPreflight reports error when Codex cannot be launched", async () => {
  const payload = await buildInstallPreflight({
    codexAppServer: {
      getStatus() {
        return {
          binaryPath: "codex",
          lastError: "spawn codex ENOENT",
          listenUrl: "ws://127.0.0.1:4321",
          readyUrl: "http://127.0.0.1:4321/readyz",
          started: false,
          startupLogs: ["spawn codex ENOENT"]
        };
      },
      async listThreads() {
        throw new Error("spawn codex ENOENT");
      }
    },
    cwd: "/tmp/dextunnel",
    runtimeConfig: {
      appServerListenUrl: "ws://127.0.0.1:4321",
      codexBinaryPath: "codex",
      host: "127.0.0.1",
      port: 4317,
      runtimeProfile: "default"
    },
    resolveBinary: () => ({
      configuredPath: "codex",
      error: "Could not find 'codex' on PATH.",
      found: false,
      resolvedPath: null,
      source: "path"
    }),
    checkReady: async () => ({
      error: "Timed out waiting for Codex app-server readiness.",
      ok: false,
      statusCode: null
    })
  });

  assert.equal(payload.status, "error");
  assert.equal(payload.codexBinary.found, false);
  assert.match(payload.summary, /cannot find a usable Codex binary/i);
  assert.match(payload.nextSteps[0], /Install Codex locally/i);
});
