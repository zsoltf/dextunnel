import test from "node:test";
import assert from "node:assert/strict";

import { createSessionStore } from "../src/lib/session-store.mjs";

test("switching strategy updates capability ladder", () => {
  const store = createSessionStore();

  store.applyCommand({
    type: "set_strategy",
    strategyId: "video-only",
    source: "test"
  });

  const snapshot = store.getState();
  assert.equal(snapshot.session.strategy.id, "video-only");
  assert.deepEqual(snapshot.session.strategy.capabilities, [
    "window_stream",
    "generic_input_only"
  ]);
});

test("approving clears the pending approval card", () => {
  const store = createSessionStore();

  store.applyCommand({
    type: "queue_approval",
    source: "test"
  });

  assert.ok(store.getState().pendingApproval);

  store.applyCommand({
    type: "approve",
    source: "test"
  });

  const snapshot = store.getState();
  assert.equal(snapshot.pendingApproval, null);
});

test("send_text appends a user message and marks the session as running", () => {
  const store = createSessionStore();

  store.applyCommand({
    type: "send_text",
    source: "test",
    text: "Check the fallback ladder."
  });

  const snapshot = store.getState();
  const userMessage = snapshot.transcript.at(-1);

  assert.equal(snapshot.session.status, "running");
  assert.equal(userMessage.role, "user");
  assert.equal(userMessage.text, "Check the fallback ladder.");
});
