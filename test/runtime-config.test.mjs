import test from "node:test";
import assert from "node:assert/strict";

import { createRuntimeConfig } from "../src/lib/runtime-config.mjs";

const SERVER_IMPORT_URL = new URL("../src/server.mjs", import.meta.url).href;

test("runtime config keeps the default launch profile boring", () => {
  const config = createRuntimeConfig({
    cwd: "/tmp/dextunnel",
    env: {
      PORT: "4317"
    },
    importMetaUrl: SERVER_IMPORT_URL
  });

  assert.equal(config.runtimeProfile, "default");
  assert.equal(config.devToolsEnabled, false);
  assert.equal(config.useFakeAppServer, false);
  assert.equal(config.useFakeAgentRoom, false);
  assert.equal(config.exposeHostSurface, false);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4317);
  assert.match(config.publicDir, /\/public$/);
  assert.match(config.attachmentDir, /dextunnel-attachments$/);
  assert.match(config.agentRoomDir, /\.agent\/artifacts\/runtime\/agent-room$/);
});

test("runtime config makes dev affordances explicit instead of implicit", () => {
  const config = createRuntimeConfig({
    cwd: "/tmp/dextunnel",
    env: {
      DEXTUNNEL_ENABLE_DEVTOOLS: "true",
      DEXTUNNEL_FAKE_APP_SERVER: "yes",
      DEXTUNNEL_FAKE_AGENT_ROOM: "on",
      DEXTUNNEL_FAKE_AGENT_ROOM_FAILURES: "gemini:timeout*2,oracle:malformed,bad:ignored",
      DEXTUNNEL_FAKE_SEND_DELAY_MS: "250",
      DEXTUNNEL_PROFILE: "dev",
      DEXTUNNEL_APP_SERVER_URL: "ws://0.0.0.0:9999",
      DEXTUNNEL_HOST: "0.0.0.0",
      DEXTUNNEL_CODEX_BINARY: "/tmp/codex-test",
      PORT: "5555"
    },
    importMetaUrl: SERVER_IMPORT_URL
  });

  assert.equal(config.runtimeProfile, "dev");
  assert.equal(config.devToolsEnabled, true);
  assert.equal(config.useFakeAppServer, true);
  assert.equal(config.useFakeAgentRoom, true);
  assert.deepEqual(config.fakeAgentRoomFailures, {
    gemini: { count: 2, mode: "timeout" },
    oracle: { count: 1, mode: "malformed" }
  });
  assert.equal(config.exposeHostSurface, false);
  assert.equal(config.fakeSendDelayMs, 250);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.appServerListenUrl, "ws://0.0.0.0:9999");
  assert.equal(config.codexBinaryPath, "/tmp/codex-test");
  assert.equal(config.port, 5555);
});

test("runtime config requires an explicit flag before serving host surface beyond loopback", () => {
  const config = createRuntimeConfig({
    cwd: "/tmp/dextunnel",
    env: {
      DEXTUNNEL_EXPOSE_HOST_SURFACE: "true",
      DEXTUNNEL_HOST: "0.0.0.0"
    },
    importMetaUrl: SERVER_IMPORT_URL
  });

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.exposeHostSurface, true);
});
