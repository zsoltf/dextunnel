import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAgentRoomRuntime } from "../src/lib/agent-room-runtime.mjs";
import { normalizeAgentRoomReply } from "../src/lib/agent-room-text.mjs";

test("normalizeAgentRoomReply trims oracle wrapper chatter down to the answer", () => {
  const raw = [
    "🧿 oracle 0.9.0 — One command, several seers; results stay grounded.",
    "Launching browser mode (gpt-5.4-pro) with ~1,273 tokens.",
    "This run can take up to an hour (usually ~10 minutes).",
    "Answer:",
    "Hello from the Oracle lane — the launch risk I care about most is ambiguous authority boundaries.",
    "",
    "3m34s · gpt-5.4-pro[browser] · ↑1.27k ↓45 ↻0 Δ1.32k",
    "files=1"
  ].join("\n");

  assert.equal(
    normalizeAgentRoomReply("oracle", raw),
    "Hello from the Oracle lane — the launch risk I care about most is ambiguous authority boundaries."
  );
});

test("normalizeAgentRoomReply keeps already-clean replies intact", () => {
  const raw = "Hello from the Gemini lane; I care most about stale control state.";
  assert.equal(
    normalizeAgentRoomReply("gemini", raw),
    raw
  );
});

test("agent room runtime times out a slow participant", async () => {
  const artifactsDir = await mkdtemp(path.join(tmpdir(), "dextunnel-agent-room-timeout-"));
  const runtime = createAgentRoomRuntime({
    artifactsDir,
    fake: true,
    participantTimeoutMs: 1
  });
  const prepared = await runtime.prepareRound({
    contextMarkdown: "# context",
    roundId: "round-1",
    threadId: "thread-1"
  });

  await assert.rejects(
    runtime.runParticipant({
      contextFile: prepared.contextFile,
      participantId: "gemini",
      promptText: "Discuss the latest diff.",
      roundDir: prepared.roundDir
    }),
    /timed out/i
  );
});

test("agent room runtime rejects a malformed participant reply", async () => {
  const artifactsDir = await mkdtemp(path.join(tmpdir(), "dextunnel-agent-room-malformed-"));
  const runtime = createAgentRoomRuntime({
    artifactsDir,
    participantRunner: async () => "   "
  });
  const prepared = await runtime.prepareRound({
    contextMarkdown: "# context",
    roundId: "round-2",
    threadId: "thread-2"
  });

  await assert.rejects(
    runtime.runParticipant({
      contextFile: prepared.contextFile,
      participantId: "oracle",
      promptText: "Discuss the latest diff.",
      roundDir: prepared.roundDir
    }),
    /malformed reply/i
  );
});

test("agent room runtime requires explicit oracle config for real oracle runs", async () => {
  const artifactsDir = await mkdtemp(path.join(tmpdir(), "dextunnel-agent-room-oracle-config-"));
  const runtime = createAgentRoomRuntime({
    artifactsDir
  });
  const prepared = await runtime.prepareRound({
    contextMarkdown: "# context",
    roundId: "round-2b",
    threadId: "thread-2b"
  });

  const priorRemoteChrome = process.env.DEXTUNNEL_ORACLE_REMOTE_CHROME;
  const priorProjectUrl = process.env.DEXTUNNEL_ORACLE_PROJECT_URL;
  const priorOracleRemoteChrome = process.env.ORACLE_REMOTE_CHROME;
  const priorOracleProjectUrl = process.env.ORACLE_PROJECT_URL;
  delete process.env.DEXTUNNEL_ORACLE_REMOTE_CHROME;
  delete process.env.DEXTUNNEL_ORACLE_PROJECT_URL;
  delete process.env.ORACLE_REMOTE_CHROME;
  delete process.env.ORACLE_PROJECT_URL;

  try {
    await assert.rejects(
      runtime.runParticipant({
        contextFile: prepared.contextFile,
        participantId: "oracle",
        promptText: "Discuss the latest diff.",
        roundDir: prepared.roundDir
      }),
      /Oracle lane requires/
    );
  } finally {
    if (priorRemoteChrome === undefined) {
      delete process.env.DEXTUNNEL_ORACLE_REMOTE_CHROME;
    } else {
      process.env.DEXTUNNEL_ORACLE_REMOTE_CHROME = priorRemoteChrome;
    }
    if (priorProjectUrl === undefined) {
      delete process.env.DEXTUNNEL_ORACLE_PROJECT_URL;
    } else {
      process.env.DEXTUNNEL_ORACLE_PROJECT_URL = priorProjectUrl;
    }
    if (priorOracleRemoteChrome === undefined) {
      delete process.env.ORACLE_REMOTE_CHROME;
    } else {
      process.env.ORACLE_REMOTE_CHROME = priorOracleRemoteChrome;
    }
    if (priorOracleProjectUrl === undefined) {
      delete process.env.ORACLE_PROJECT_URL;
    } else {
      process.env.ORACLE_PROJECT_URL = priorOracleProjectUrl;
    }
  }
});

test("agent room runtime fake failures fire once so retries can recover", async () => {
  const artifactsDir = await mkdtemp(path.join(tmpdir(), "dextunnel-agent-room-fake-failures-"));
  const runtime = createAgentRoomRuntime({
    artifactsDir,
    fake: true,
    fakeFailures: {
      gemini: { count: 1, mode: "timeout" },
      oracle: { count: 1, mode: "malformed" }
    },
    participantTimeoutMs: 120
  });
  const prepared = await runtime.prepareRound({
    contextMarkdown: "# context",
    roundId: "round-3",
    threadId: "thread-3"
  });

  await assert.rejects(
    runtime.runParticipant({
      contextFile: prepared.contextFile,
      participantId: "gemini",
      promptText: "Discuss the latest diff.",
      roundDir: prepared.roundDir
    }),
    /timed out/i
  );
  await assert.rejects(
    runtime.runParticipant({
      contextFile: prepared.contextFile,
      participantId: "oracle",
      promptText: "Discuss the latest diff.",
      roundDir: prepared.roundDir
    }),
    /malformed reply/i
  );

  const geminiRetry = await runtime.runParticipant({
    contextFile: prepared.contextFile,
    participantId: "gemini",
    promptText: "Discuss the latest diff.",
    roundDir: prepared.roundDir
  });
  const oracleRetry = await runtime.runParticipant({
    contextFile: prepared.contextFile,
    participantId: "oracle",
    promptText: "Discuss the latest diff.",
    roundDir: prepared.roundDir
  });

  assert.match(geminiRetry, /^gemini:/i);
  assert.match(oracleRetry, /^oracle:/i);
});

test("agent room runtime can keep failing across multiple retries when requested", async () => {
  const artifactsDir = await mkdtemp(path.join(tmpdir(), "dextunnel-agent-room-fake-repeat-"));
  const runtime = createAgentRoomRuntime({
    artifactsDir,
    fake: true,
    fakeFailures: {
      gemini: { count: 2, mode: "timeout" }
    },
    participantTimeoutMs: 120
  });
  const prepared = await runtime.prepareRound({
    contextMarkdown: "# context",
    roundId: "round-4",
    threadId: "thread-4"
  });

  await assert.rejects(
    runtime.runParticipant({
      contextFile: prepared.contextFile,
      participantId: "gemini",
      promptText: "Keep discussing the launch bar.",
      roundDir: prepared.roundDir
    }),
    /timed out/i
  );
  await assert.rejects(
    runtime.runParticipant({
      contextFile: prepared.contextFile,
      participantId: "gemini",
      promptText: "Keep discussing the launch bar.",
      roundDir: prepared.roundDir
    }),
    /timed out/i
  );

  const recovered = await runtime.runParticipant({
    contextFile: prepared.contextFile,
    participantId: "gemini",
    promptText: "Keep discussing the launch bar.",
    roundDir: prepared.roundDir
  });
  assert.match(recovered, /^gemini:/i);
});
