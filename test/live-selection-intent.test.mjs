import test from "node:test";
import assert from "node:assert/strict";

import {
  createSelectionIntent,
  reconcileSelectionIntent,
  selectionIntentMessage,
  selectionIntentTitle,
  selectionIntentSatisfied
} from "../public/live-selection-intent.js";

test("thread-target intent settles when the selected thread matches", () => {
  const intent = createSelectionIntent({
    cwd: "/repo-a",
    projectLabel: "repo-a",
    source: "remote",
    threadId: "thread-a",
    threadLabel: "#alpha"
  });

  assert.equal(
    selectionIntentSatisfied(intent, {
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-a"
    }),
    true
  );

  assert.deepEqual(
    reconcileSelectionIntent(intent, {
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-a"
    }),
    {
      intent: null,
      settled: true
    }
  );
});

test("cwd-only intent settles when the selected project matches", () => {
  const intent = createSelectionIntent({
    cwd: "/repo-b",
    projectLabel: "repo-b",
    source: "host"
  });

  assert.equal(
    selectionIntentSatisfied(intent, {
      selectedProjectCwd: "/repo-b",
      selectedThreadId: "thread-z"
    }),
    true
  );
});

test("mismatched live state keeps the intent active", () => {
  const intent = createSelectionIntent({
    cwd: "/repo-a",
    projectLabel: "repo-a",
    source: "remote",
    threadId: "thread-a",
    threadLabel: "#alpha"
  });

  assert.deepEqual(
    reconcileSelectionIntent(intent, {
      selectedProjectCwd: "/repo-a",
      selectedThreadId: "thread-b"
    }),
    {
      intent,
      settled: false
    }
  );
});

test("selection message prefers thread label, then project label", () => {
  assert.equal(
    selectionIntentMessage(
      createSelectionIntent({
        cwd: "/repo-a",
        projectLabel: "repo-a",
        threadId: "thread-a",
        threadLabel: "#alpha"
      })
    ),
    "Switching to #alpha..."
  );

  assert.equal(
    selectionIntentMessage(
      createSelectionIntent({
        cwd: "/repo-b",
        projectLabel: "repo-b"
      })
    ),
    "Switching to repo-b..."
  );

  assert.equal(
    selectionIntentTitle(
      createSelectionIntent({
        cwd: "/repo-a",
        projectLabel: "repo-a",
        threadId: "thread-a",
        threadLabel: "Respond to user check-in"
      })
    ),
    "#respond-to-user-check-in"
  );
});
