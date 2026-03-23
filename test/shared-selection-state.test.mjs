import test from "node:test";
import assert from "node:assert/strict";

import { applySharedSelectionState } from "../src/lib/shared-selection-state.mjs";

test("switching to a different explicit thread clears snapshot and stale thread-scoped state", () => {
  const previousSnapshot = { thread: { id: "thread-a" } };
  const result = applySharedSelectionState(
    {
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-a",
      selectedThreadSnapshot: previousSnapshot,
      selectionSource: "remote",
      turnDiff: { diff: "x", threadId: "thread-a" },
      writeLock: { status: "pending", threadId: "thread-a" }
    },
    {
      source: "host",
      threadId: "thread-b"
    }
  );

  assert.equal(result.threadChanged, true);
  assert.deepEqual(result.nextState, {
    selectedProjectCwd: "/repo-a",
    selectedThreadId: "thread-b",
    selectedThreadSnapshot: null,
    selectionSource: "host",
    turnDiff: null,
    writeLock: null
  });
});

test("reselecting the same thread preserves snapshot and matching thread-scoped state", () => {
  const previousSnapshot = { thread: { id: "thread-a" } };
  const turnDiff = { diff: "x", threadId: "thread-a" };
  const writeLock = { status: "pending", threadId: "thread-a" };
  const result = applySharedSelectionState(
    {
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-a",
      selectedThreadSnapshot: previousSnapshot,
      selectionSource: "remote",
      turnDiff,
      writeLock
    },
    {
      source: "remote",
      threadId: "thread-a"
    }
  );

  assert.equal(result.threadChanged, false);
  assert.deepEqual(result.nextState, {
    selectedProjectCwd: "/repo-a",
    selectedThreadId: "thread-a",
    selectedThreadSnapshot: previousSnapshot,
    selectionSource: "remote",
    turnDiff,
    writeLock
  });
});

test("cwd-only selection chooses the matching thread and clears stale state from another thread", () => {
  const result = applySharedSelectionState(
    {
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-a",
      selectedThreadSnapshot: { thread: { id: "thread-a" } },
      selectionSource: "remote",
      turnDiff: { diff: "stale", threadId: "thread-z" },
      writeLock: { status: "running", threadId: "thread-z" }
    },
    {
      cwd: "/repo-b",
      source: "remote",
      threads: [
        { cwd: "/repo-a", id: "thread-a" },
        { cwd: "/repo-b", id: "thread-b" }
      ]
    }
  );

  assert.equal(result.threadChanged, true);
  assert.deepEqual(result.nextState, {
    selectedProjectCwd: "/repo-b",
    selectedThreadId: "thread-b",
    selectedThreadSnapshot: null,
    selectionSource: "remote",
    turnDiff: null,
    writeLock: null
  });
});

test("same-thread selection still drops mismatched stale write state", () => {
  const previousSnapshot = { thread: { id: "thread-a" } };
  const result = applySharedSelectionState(
    {
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-a",
      selectedThreadSnapshot: previousSnapshot,
      selectionSource: "remote",
      turnDiff: { diff: "stale", threadId: "thread-b" },
      writeLock: { status: "pending", threadId: "thread-b" }
    },
    {
      source: "remote",
      threadId: "thread-a"
    }
  );

  assert.equal(result.threadChanged, false);
  assert.deepEqual(result.nextState, {
    selectedProjectCwd: "/repo-a",
    selectedThreadId: "thread-a",
    selectedThreadSnapshot: previousSnapshot,
    selectionSource: "remote",
    turnDiff: null,
    writeLock: null
  });
});
