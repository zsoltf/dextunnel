import test from "node:test";
import assert from "node:assert/strict";

import { DESKTOP_REHYDRATION_ATTEMPTS, runDesktopRehydrationSmoke } from "../src/lib/desktop-rehydration-smoke.mjs";

function createFakeBridge({
  readThreadResult = {},
  resumeThreadResult = {},
  sendTurnId = "turn-123"
} = {}) {
  const calls = [];
  return {
    bridge: {
      async dispose() {
        calls.push({ kind: "dispose" });
      },
      async readThread(threadId) {
        calls.push({ kind: "readThread", threadId });
        return readThreadResult;
      },
      async resumeThread(payload) {
        calls.push({ kind: "resumeThread", payload });
        return resumeThreadResult;
      },
      async sendText(payload) {
        calls.push({ kind: "sendText", payload });
        return {
          turn: {
            id: sendTurnId,
            status: "completed"
          }
        };
      }
    },
    calls
  };
}

test("desktop rehydration smoke runs the known non-destructive attempt matrix", async () => {
  const promptStamp = "20260320T200000Z";
  const prompt = `REHYDRATION_SMOKE_${promptStamp}. Reply with exactly: REHYDRATION_SMOKE_ACK_${promptStamp}.`;
  const ack = `REHYDRATION_SMOKE_ACK_${promptStamp}`;
  const { bridge, calls } = createFakeBridge({
    readThreadResult: {
      id: "thread-1",
      transcript: [prompt, ack]
    },
    resumeThreadResult: {
      id: "thread-1",
      transcript: [prompt, ack]
    }
  });
  const navigationCalls = [];
  const revealCalls = [];

  const report = await runDesktopRehydrationSmoke({
    bridgeFactory: async () => bridge,
    cwd: "/tmp/dextunnel",
    openThread: async (threadId) => {
      revealCalls.push(threadId);
      return { deeplink: `codex://threads/${threadId}` };
    },
    promptStamp,
    runNavigationSequence: async (sequenceId) => {
      navigationCalls.push(sequenceId);
      return { sequenceId };
    },
    threadId: "thread-1"
  });

  assert.equal(report.probe.status, "persisted");
  assert.equal(report.probe.promptVisible, true);
  assert.equal(report.probe.ackVisible, true);
  assert.deepEqual(revealCalls, ["thread-1"]);
  assert.deepEqual(navigationCalls, ["viewBackForward", "viewPreviousNextThread"]);
  assert.deepEqual(
    report.attempts.map((attempt) => attempt.id),
    DESKTOP_REHYDRATION_ATTEMPTS.map((attempt) => attempt.id)
  );
  assert.equal(
    calls.find((entry) => entry.kind === "sendText").payload.text,
    prompt
  );
});

test("desktop rehydration smoke skips desktop attempts when write/readback proof is not clean", async () => {
  const { bridge } = createFakeBridge({
    readThreadResult: {
      id: "thread-2",
      transcript: []
    },
    resumeThreadResult: {
      id: "thread-2",
      transcript: []
    }
  });
  const navigationCalls = [];

  const report = await runDesktopRehydrationSmoke({
    bridgeFactory: async () => bridge,
    openThread: async () => {
      throw new Error("should not reveal");
    },
    probePollMs: 0,
    probeTimeoutMs: 0,
    runNavigationSequence: async (sequenceId) => {
      navigationCalls.push(sequenceId);
      return { sequenceId };
    },
    threadId: "thread-2"
  });

  assert.equal(report.probe.status, "readback-mismatch");
  assert.deepEqual(navigationCalls, []);
  assert.deepEqual(
    report.attempts
      .filter((attempt) => attempt.category === "desktop")
      .map((attempt) => attempt.status),
    ["skipped", "skipped", "skipped"]
  );
});

test("desktop rehydration smoke records manual restart as the confirmed positive path", async () => {
  const promptStamp = "20260320T210000Z";
  const prompt = `REHYDRATION_SMOKE_${promptStamp}. Reply with exactly: REHYDRATION_SMOKE_ACK_${promptStamp}.`;
  const ack = `REHYDRATION_SMOKE_ACK_${promptStamp}`;
  const { bridge } = createFakeBridge({
    readThreadResult: {
      id: "thread-3",
      transcript: [prompt, ack]
    },
    resumeThreadResult: {
      id: "thread-3",
      transcript: [prompt, ack]
    }
  });
  const report = await runDesktopRehydrationSmoke({
    bridgeFactory: async () => bridge,
    openThread: async (threadId) => ({ threadId }),
    promptStamp,
    runNavigationSequence: async (sequenceId) => ({ sequenceId }),
    threadId: "thread-3"
  });

  assert.equal(report.attempts.some((attempt) => attempt.id === "restartCodexAndReveal"), false);
  assert.match(report.manualChecks.at(-1), /quit and reopen the Codex app manually/i);
});
