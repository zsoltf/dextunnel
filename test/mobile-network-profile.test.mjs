import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveMobileNetworkProfile,
  withNetworkJitter
} from "../src/lib/mobile-network-profile.mjs";

test("resolveMobileNetworkProfile returns known presets", () => {
  const profile = resolveMobileNetworkProfile("weak-mobile");
  assert.equal(profile.name, "weak-mobile");
  assert.equal(profile.requestDelayMs > 0, true);
  assert.equal(profile.downstreamBytesPerSecond > 0, true);
});

test("resolveMobileNetworkProfile returns null for unknown names", () => {
  assert.equal(resolveMobileNetworkProfile("unknown"), null);
});

test("withNetworkJitter keeps zero jitter stable", () => {
  assert.equal(withNetworkJitter(180, 0), 180);
});
