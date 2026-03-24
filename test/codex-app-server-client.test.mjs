import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildSessionLogSnapshot,
  getWritableTurnStrategy,
  mapThreadToCompanionSnapshot,
  pageTranscriptEntries,
  readTranscriptHistoryPageFromSessionLog,
  readTranscriptFromSessionLog
} from "../src/lib/codex-app-server-client.mjs";

test("mapThreadToCompanionSnapshot flattens user and agent items", () => {
  const snapshot = mapThreadToCompanionSnapshot({
    id: "thread-1",
    name: "Example",
    preview: "Preview",
    source: "vscode",
    cwd: "/tmp/example",
    status: { type: "notLoaded" },
    updatedAt: 123,
    path: "/tmp/thread.jsonl",
    turns: [
      {
        id: "turn-1",
        status: "completed",
        updatedAt: 456,
        items: [
          {
            type: "userMessage",
            id: "item-1",
            content: [{ type: "text", text: "Hello from user" }]
          },
          {
            type: "agentMessage",
            id: "item-2",
            text: "Hello from assistant",
            phase: "commentary"
          }
        ]
      }
    ]
  });

  assert.equal(snapshot.thread.id, "thread-1");
  assert.equal(snapshot.transcriptCount, 2);
  assert.equal(snapshot.transcript.length, 2);
  assert.deepEqual(
    snapshot.transcript.map((entry) => ({ role: entry.role, text: entry.text })),
    [
      { role: "user", text: "Hello from user" },
      { role: "assistant", text: "Hello from assistant" }
    ]
  );
});

test("mapThreadToCompanionSnapshot can limit visible transcript entries", () => {
  const snapshot = mapThreadToCompanionSnapshot(
    {
      id: "thread-2",
      turns: [
        {
          id: "turn-1",
          items: [
            { type: "agentMessage", text: "one", phase: "message" },
            { type: "agentMessage", text: "two", phase: "message" },
            { type: "agentMessage", text: "three", phase: "message" }
          ]
        }
      ]
    },
    { limit: 2 }
  );

  assert.equal(snapshot.transcriptCount, 3);
  assert.deepEqual(
    snapshot.transcript.map((entry) => entry.text),
    ["two", "three"]
  );
});

test("getWritableTurnStrategy prefers turn start when nothing is active", () => {
  assert.deepEqual(
    getWritableTurnStrategy({
      turns: [
        { id: "turn-1", status: "completed" },
        { id: "turn-2", status: "failed" }
      ]
    }),
    {
      mode: "start",
      expectedTurnId: null
    }
  );
});

test("getWritableTurnStrategy uses steer for an in-progress turn", () => {
  assert.deepEqual(
    getWritableTurnStrategy({
      turns: [
        { id: "turn-1", status: "completed" },
        { id: "turn-2", status: "inProgress" }
      ]
    }),
    {
      mode: "steer",
      expectedTurnId: "turn-2"
    }
  );
});

test("readTranscriptFromSessionLog recovers recent user, assistant, and tool entries from the session tail", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dextunnel-session-log-"));
  const sessionPath = path.join(dir, "thread.jsonl");
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: "2026-03-21T20:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello from the phone" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-21T20:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: [{ type: "output_text", text: "checking the bridge" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-03-21T20:00:02.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          output: "Command: npm test\nOutput: 181/181 passing"
        }
      })
    ].join("\n"),
    "utf8"
  );

  const transcript = readTranscriptFromSessionLog(sessionPath, { limit: null, maxBytes: 16 * 1024 });

  assert.deepEqual(
    transcript.map((entry) => ({ role: entry.role, kind: entry.kind, text: entry.text })),
    [
      { role: "user", kind: "message", text: "hello from the phone" },
      { role: "assistant", kind: "commentary", text: "checking the bridge" },
      { role: "tool", kind: "tool_output", text: "Command: npm test" }
    ]
  );
});

test("buildSessionLogSnapshot shapes a lightweight transcript snapshot from thread metadata plus session log tail", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dextunnel-session-snapshot-"));
  const sessionPath = path.join(dir, "thread.jsonl");
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: "2026-03-21T21:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "latest reply" }]
        }
      })
    ].join("\n"),
    "utf8"
  );

  const snapshot = buildSessionLogSnapshot({
    id: "thread-light",
    name: "Light thread",
    preview: "stale preview",
    source: "vscode",
    cwd: "/tmp/example",
    status: { type: "idle" },
    updatedAt: 1774150000,
    path: sessionPath
  }, { limit: 10, maxBytes: 16 * 1024 });

  assert.equal(snapshot.thread.id, "thread-light");
  assert.equal(snapshot.thread.path, sessionPath);
  assert.equal(snapshot.transcriptCount, 1);
  assert.equal(snapshot.transcript[0].text, "latest reply");
});

test("readTranscriptHistoryPageFromSessionLog pages older transcript entries by visible count and cursor", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dextunnel-session-history-"));
  const sessionPath = path.join(dir, "thread.jsonl");
  await writeFile(
    sessionPath,
    ["one", "two", "three", "four", "five"]
      .map((text, index) => JSON.stringify({
        timestamp: `2026-03-21T22:00:0${index}.000Z`,
        type: "response_item",
        payload: {
          type: "message",
          role: index % 2 === 0 ? "assistant" : "user",
          content: [{ type: "output_text", text }]
        }
      }))
      .join("\n"),
    "utf8"
  );

  const firstOlderPage = readTranscriptHistoryPageFromSessionLog(sessionPath, {
    limit: 2,
    visibleCount: 2
  });

  assert.deepEqual(firstOlderPage.items.map((entry) => entry.text), ["two", "three"]);
  assert.equal(firstOlderPage.nextBeforeIndex, 1);
  assert.equal(firstOlderPage.hasMore, true);
  assert.equal(firstOlderPage.totalCount, 5);

  const secondOlderPage = readTranscriptHistoryPageFromSessionLog(sessionPath, {
    beforeIndex: firstOlderPage.nextBeforeIndex,
    limit: 2
  });

  assert.deepEqual(secondOlderPage.items.map((entry) => entry.text), ["one"]);
  assert.equal(secondOlderPage.nextBeforeIndex, null);
  assert.equal(secondOlderPage.hasMore, false);
});

test("pageTranscriptEntries keeps a stable cursor across an in-memory transcript", () => {
  const transcript = ["one", "two", "three", "four", "five", "six"].map((text, index) => ({
    id: `entry-${index + 1}`,
    text,
    timestamp: `2026-03-21T23:00:0${index}.000Z`
  }));

  const firstOlderPage = pageTranscriptEntries(transcript, {
    limit: 2,
    visibleCount: 2
  });

  assert.deepEqual(firstOlderPage.items.map((entry) => entry.text), ["three", "four"]);
  assert.equal(firstOlderPage.nextBeforeIndex, 2);
  assert.equal(firstOlderPage.hasMore, true);
  assert.equal(firstOlderPage.totalCount, 6);

  const secondOlderPage = pageTranscriptEntries(transcript, {
    beforeIndex: firstOlderPage.nextBeforeIndex,
    limit: 2
  });

  assert.deepEqual(secondOlderPage.items.map((entry) => entry.text), ["one", "two"]);
  assert.equal(secondOlderPage.nextBeforeIndex, null);
  assert.equal(secondOlderPage.hasMore, false);
});
