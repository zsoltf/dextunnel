import test from "node:test";
import assert from "node:assert/strict";

import { createSurfaceViewState } from "../public/surface-view-state.js";

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    }
  };
}

test("surface view state restores default filters when nothing is stored", () => {
  const viewState = createSurfaceViewState({
    defaults: {
      filters: {
        advisories: true,
        changes: true,
        thread: true,
        tools: false,
        updates: true
      }
    },
    storage: createMemoryStorage(),
    surface: "remote"
  });

  assert.deepEqual(viewState.loadFilters(), {
    advisories: true,
    changes: true,
    thread: true,
    tools: false,
    updates: true
  });
});

test("surface view state persists filters per surface", () => {
  const storage = createMemoryStorage();
  const remote = createSurfaceViewState({
    defaults: { filters: { thread: true, tools: false } },
    scopeId: "remote-a",
    storage,
    surface: "remote"
  });
  const host = createSurfaceViewState({
    defaults: { filters: { thread: true, tools: false } },
    scopeId: "host-a",
    storage,
    surface: "host"
  });

  remote.saveFilters({ thread: false, tools: true });

  assert.deepEqual(remote.loadFilters(), { thread: false, tools: true });
  assert.deepEqual(host.loadFilters(), { thread: true, tools: false });
});

test("surface view state persists expanded sections per surface and thread", () => {
  const storage = createMemoryStorage();
  const remote = createSurfaceViewState({
    defaults: { filters: {} },
    scopeId: "remote-a",
    storage,
    surface: "remote"
  });
  const host = createSurfaceViewState({
    defaults: { filters: {} },
    scopeId: "host-a",
    storage,
    surface: "host"
  });

  remote.saveExpandedSections("thread-a", ["changes:thread-a", "updates:thread-a"]);
  remote.saveExpandedSections("thread-b", ["changes:thread-b"]);

  assert.deepEqual(remote.loadExpandedSections("thread-a"), ["changes:thread-a", "updates:thread-a"]);
  assert.deepEqual(remote.loadExpandedSections("thread-b"), ["changes:thread-b"]);
  assert.deepEqual(host.loadExpandedSections("thread-a"), []);
});

test("surface view state stays isolated across two remote tabs", () => {
  const storage = createMemoryStorage();
  const remoteA = createSurfaceViewState({
    defaults: { filters: { thread: true, updates: true } },
    scopeId: "remote-a",
    storage,
    surface: "remote"
  });
  const remoteB = createSurfaceViewState({
    defaults: { filters: { thread: true, updates: true } },
    scopeId: "remote-b",
    storage,
    surface: "remote"
  });

  remoteA.saveFilters({ thread: false, updates: true });

  assert.deepEqual(remoteA.loadFilters(), { thread: false, updates: true });
  assert.deepEqual(remoteB.loadFilters(), { thread: true, updates: true });
});
