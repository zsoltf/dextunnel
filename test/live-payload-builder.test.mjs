import test from "node:test";
import assert from "node:assert/strict";

import { createLivePayloadBuilder } from "../src/lib/live-payload-builder.mjs";

function createDeps(overrides = {}) {
  const liveState = overrides.liveState || {
    selectedProjectCwd: "/tmp/codex/dextunnel",
    selectedThreadId: "thr_dextunnel",
    selectedThreadSnapshot: null,
    selectionSource: "remote",
    threads: [
      {
        cwd: "/tmp/codex/dextunnel",
        id: "thr_dextunnel",
        name: "dextunnel",
        preview: "latest preview",
        source: "vscode"
      }
    ],
    turnDiff: null,
    turnOriginsByThreadId: {}
  };

  return {
    ADVISORY_PARTICIPANT_IDS: ["oracle", "gemini"],
    advisoryParticipantForThread: (advisorId) => ({
      canAct: false,
      id: advisorId,
      label: advisorId,
      sortOrder: advisorId === "oracle" ? 40 : 50
    }),
    bestConversationLabel: (snapshot) => snapshot?.transcript?.at(-1)?.text || "",
    bestThreadLabel: (thread) => thread?.name || "current session",
    buildBridgeStatus: () => ({ watcherConnected: true }),
    buildParticipant: (id, overrides = {}) => ({
      id,
      label: id,
      sortOrder:
        {
          codex: 10,
          remote: 20,
          desktop: 30,
          oracle: 40,
          gemini: 50,
          updates: 70,
          tools: 80,
          system: 90,
          user: 100
        }[id] || 999,
      ...overrides
    }),
    buildSelectedAgentRoomState: () => ({ enabled: false }),
    buildSelectedAttachments: () => [{ surface: "host", count: 1 }],
    buildSelectedCompanionState: () => ({ advisories: [] }),
    getPendingInteractionForSelectedThread: () => null,
    liveState,
    looksLikeTopicNoise: (value) => String(value || "").startsWith("[$"),
    normalizeLane: (value) => String(value || "").trim().toLowerCase(),
    projectLabel: (cwd) => cwd.split("/").slice(-2).join("/"),
    pruneAllCompanionWakeups: () => {},
    pruneStaleSurfacePresence: () => {},
    repoObjective: () => "",
    selectedThreadSummary: () => liveState.threads[0],
    slugifyChannelName: (value) => String(value || "").toLowerCase().replace(/\s+/g, "-"),
    summarizeThread: (thread) => ({ id: thread.id, label: thread.name }),
    trimTopicText: (value, maxLength = 120) => String(value || "").slice(0, maxLength),
    ...overrides
  };
}

test("live payload builder prefers repo objective for the channel topic", () => {
  const builder = createLivePayloadBuilder(
    createDeps({
      repoObjective: () => "Ship boring trust first"
    })
  );

  const channel = builder.buildSelectedChannel({
    thread: {
      cwd: "/tmp/codex/dextunnel",
      id: "thr_dextunnel",
      name: "dextunnel",
      preview: "this preview should not win",
      source: "vscode"
    },
    transcript: []
  });

  assert.equal(channel.channelLabel, "dextunnel");
  assert.equal(channel.channelSlug, "#dextunnel");
  assert.equal(channel.serverLabel, "codex/dextunnel");
  assert.equal(channel.topic, "Ship boring trust first");
});

test("live payload builder decorates transcript entries with lanes and participants", () => {
  const liveState = {
    selectedProjectCwd: "/tmp/codex/dextunnel",
    selectedThreadId: "thr_dextunnel",
    selectedThreadSnapshot: null,
    selectionSource: "remote",
    threads: [],
    turnDiff: null,
    turnOriginsByThreadId: {
      thr_dextunnel: {
        "turn-remote": "remote"
      }
    }
  };
  const builder = createLivePayloadBuilder(createDeps({ liveState }));

  const snapshot = builder.decorateSnapshot({
    thread: {
      cwd: "/tmp/codex/dextunnel",
      id: "thr_dextunnel",
      name: "dextunnel",
      source: "vscode"
    },
    transcript: [
      { role: "user", text: "queued from phone", turnId: "turn-remote" },
      { kind: "commentary", role: "assistant", text: "internal note" },
      { kind: "message", role: "assistant", text: "done" }
    ]
  });

  assert.equal(snapshot.transcript[0].lane, "remote");
  assert.equal(snapshot.transcript[0].participant.id, "remote");
  assert.equal(snapshot.transcript[1].participant.id, "updates");
  assert.equal(snapshot.transcript[2].participant.id, "codex");
  assert.deepEqual(
    snapshot.participants.map((entry) => entry.id),
    ["codex", "remote", "desktop", "oracle", "gemini", "updates"]
  );
});

test("live payload builder assembles the selected payload and prunes stale state", () => {
  const calls = [];
  const liveState = {
    selectedProjectCwd: "/tmp/codex/dextunnel",
    selectedThreadId: "thr_dextunnel",
    selectedThreadSnapshot: {
      thread: {
        cwd: "/tmp/codex/dextunnel",
        id: "thr_dextunnel",
        name: "dextunnel",
        source: "vscode"
      },
      transcript: [{ role: "assistant", text: "ready" }]
    },
    selectionSource: "remote",
    threads: [{ id: "thr_dextunnel", name: "dextunnel" }],
    turnDiff: { items: [{ path: "src/server.mjs" }] },
    turnOriginsByThreadId: {}
  };

  const builder = createLivePayloadBuilder(
    createDeps({
      buildBridgeStatus: () => ({ watcherConnected: true }),
      buildSelectedAgentRoomState: () => ({ enabled: true }),
      buildSelectedAttachments: (threadId) => {
        calls.push(["attachments", threadId]);
        return [{ surface: "host", count: 2 }];
      },
      buildSelectedCompanionState: (threadId) => {
        calls.push(["companion", threadId]);
        return { advisories: [] };
      },
      getPendingInteractionForSelectedThread: () => ({ requestId: "req_1" }),
      liveState,
      pruneAllCompanionWakeups: () => calls.push(["wakeups"]),
      pruneStaleSurfacePresence: () => calls.push(["presence"]),
      summarizeThread: (thread) => ({ id: thread.id, label: thread.name })
    })
  );

  const payload = builder.buildLivePayload();

  assert.deepEqual(calls, [
    ["presence"],
    ["wakeups"],
    ["attachments", "thr_dextunnel"],
    ["companion", "thr_dextunnel"]
  ]);
  assert.equal(payload.selectedChannel.channelSlug, "#dextunnel");
  assert.deepEqual(payload.selectedAttachments, [{ surface: "host", count: 2 }]);
  assert.equal(payload.selectedAgentRoom.enabled, true);
  assert.equal(payload.pendingInteraction.requestId, "req_1");
  assert.deepEqual(payload.threads, [{ id: "thr_dextunnel", label: "dextunnel" }]);
});
