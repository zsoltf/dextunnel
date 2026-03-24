import test from "node:test";
import assert from "node:assert/strict";

import {
  createSurfaceAccessRegistry,
  injectSurfaceBootstrap
} from "../src/lib/surface-access.mjs";

test("surface access registry issues signed host and remote bootstrap tokens", () => {
  const registry = createSurfaceAccessRegistry({
    now: () => "2026-03-19T00:00:00.000Z",
    nowMs: () => new Date("2026-03-19T00:00:00.000Z").getTime(),
    secret: "test-secret"
  });

  const remote = registry.issueBootstrap("remote");
  const host = registry.issueBootstrap("host");

  assert.equal(remote.surface, "remote");
  assert.equal(host.surface, "host");
  assert.match(remote.clientId, /^remote-/);
  assert.match(host.clientId, /^host-/);
  assert.ok(remote.capabilities.includes("send_turn"));
  assert.ok(!host.capabilities.includes("send_turn"));
  assert.equal(remote.expiresAt, "2026-03-20T00:00:00.000Z");

  const resolved = registry.resolve({
    headers: {
      "x-dextunnel-surface-token": remote.accessToken
    }
  });
  assert.equal(resolved.surface, "remote");
  assert.equal(resolved.clientId, remote.clientId);
});

test("surface access registry issues an automation-friendly agent surface", () => {
  const registry = createSurfaceAccessRegistry({ secret: "test-secret" });
  const agent = registry.issueBootstrap("agent");

  assert.equal(agent.surface, "agent");
  assert.ok(agent.capabilities.includes("send_turn"));
  assert.ok(agent.capabilities.includes("control_remote"));
  assert.ok(!agent.capabilities.includes("use_companion"));
  assert.ok(!agent.capabilities.includes("use_agent_room"));
});

test("surface access tokens expire after the configured ttl", () => {
  let nowMs = new Date("2026-03-19T00:00:00.000Z").getTime();
  const registry = createSurfaceAccessRegistry({
    now: () => new Date(nowMs).toISOString(),
    nowMs: () => nowMs,
    ttlMs: 1000,
    secret: "test-secret"
  });

  const remote = registry.issueBootstrap("remote");
  assert.ok(
    registry.resolve({
      headers: {
        "x-dextunnel-surface-token": remote.accessToken
      }
    })
  );

  nowMs += 1500;
  assert.equal(
    registry.resolve({
      headers: {
        "x-dextunnel-surface-token": remote.accessToken
      }
    }),
    null
  );
});

test("surface access registry accepts bearer auth as a first-class transport", () => {
  const registry = createSurfaceAccessRegistry({ secret: "test-secret" });
  const agent = registry.issueBootstrap("agent");
  const resolved = registry.resolve({
    headers: {
      authorization: `Bearer ${agent.accessToken}`
    }
  });

  assert.equal(resolved?.surface, "agent");
  assert.equal(resolved?.clientId, agent.clientId);
});

test("surface access capability checks reject invalid or downgraded tokens", () => {
  const registry = createSurfaceAccessRegistry({ secret: "test-secret" });
  const host = registry.issueBootstrap("host");

  assert.throws(
    () =>
      registry.requireCapability({
        capability: "send_turn",
        headers: {
          "x-dextunnel-surface-token": host.accessToken
        }
      }),
    /host surface is not allowed/
  );

  assert.throws(
    () =>
      registry.requireCapability({
        capability: "read_room",
        headers: {
          "x-dextunnel-surface-token": `${host.accessToken}tampered`
        }
      }),
    /missing or expired/
  );
});

test("injectSurfaceBootstrap adds the runtime token to the served html", () => {
  const html = "<html><body><main>hello</main></body></html>";
  const injected = injectSurfaceBootstrap(html, {
    accessToken: "abc",
    capabilities: ["read_room"],
    expiresAt: "2026-03-20T00:00:00.000Z",
    issuedAt: "2026-03-19T00:00:00.000Z",
    surface: "remote"
  });

  assert.match(injected, /__DEXTUNNEL_SURFACE_BOOTSTRAP__/);
  assert.match(injected, /"surface":"remote"/);
  assert.match(injected, /"accessToken":"abc"/);
  assert.match(injected, /"expiresAt":"2026-03-20T00:00:00.000Z"/);
});
