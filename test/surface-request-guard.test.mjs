import test from "node:test";
import assert from "node:assert/strict";

import {
  canServeSurfaceBootstrap,
  isSameMachineAddress,
  isLoopbackAddress
} from "../src/lib/surface-request-guard.mjs";

test("surface request guard recognizes loopback addresses", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("127.0.0.42"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.64.10"), false);
});

test("surface request guard keeps remote surface broadly reachable", () => {
  assert.equal(
    canServeSurfaceBootstrap({
      pathname: "/remote.html",
      remoteAddress: "192.168.64.10"
    }),
    true
  );
});

test("surface request guard keeps host surface loopback-only unless explicitly enabled", () => {
  assert.equal(
    canServeSurfaceBootstrap({
      pathname: "/host.html",
      remoteAddress: "192.168.64.10"
    }),
    false
  );

  assert.equal(
    canServeSurfaceBootstrap({
      pathname: "/host.html",
      remoteAddress: "127.0.0.1"
    }),
    true
  );

  assert.equal(
    canServeSurfaceBootstrap({
      exposeHostSurface: true,
      pathname: "/host.html",
      remoteAddress: "192.168.64.10"
      }),
      true
  );
});

test("surface request guard allows same-machine host bootstrap on a bound non-loopback address", () => {
  assert.equal(isSameMachineAddress("100.125.72.45", "100.125.72.45"), true);
  assert.equal(isSameMachineAddress("::ffff:100.125.72.45", "100.125.72.45"), true);
  assert.equal(
    canServeSurfaceBootstrap({
      pathname: "/host.html",
      remoteAddress: "100.125.72.45",
      localAddress: "100.125.72.45"
    }),
    true
  );
});
