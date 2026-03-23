import test from "node:test";
import assert from "node:assert/strict";

import { createAgentRoomContextBuilder } from "../src/lib/agent-room-context.mjs";

test("agent room context builder renders both main thread and council transcript excerpts", () => {
  const builder = createAgentRoomContextBuilder({
    buildSelectedChannel: () => ({
      channelId: "thr_dextunnel",
      channelSlug: "#dextunnel",
      serverLabel: "codex/dextunnel",
      topic: "Keep boring trust first"
    }),
    decorateSnapshot: (snapshot) => ({
      ...snapshot,
      channel: {
        channelId: "thr_dextunnel",
        channelSlug: "#dextunnel",
        serverLabel: "codex/dextunnel",
        topic: "Keep boring trust first"
      }
    }),
    nowIso: () => "2026-03-20T08:00:00.000Z",
    trimTopicText: (value, maxLength = 280) => String(value || "").slice(0, maxLength)
  });

  const markdown = builder.buildAgentRoomContextMarkdown({
    roomState: {
      messages: [
        {
          participantId: "oracle",
          text: "You still need better misclassification proof.",
          timestamp: "2026-03-20T07:58:00.000Z"
        }
      ]
    },
    snapshot: {
      transcript: [
        {
          participant: { label: "codex" },
          text: "I am tightening the daemon seam next.",
          timestamp: "2026-03-20T07:59:00.000Z"
        }
      ]
    },
    threadId: "thr_dextunnel"
  });

  assert.match(markdown, /# Dextunnel Council Room Context/);
  assert.match(markdown, /thread_id: thr_dextunnel/);
  assert.match(markdown, /server: codex\/dextunnel/);
  assert.match(markdown, /\[2026-03-20T07:59:00.000Z\] codex: I am tightening the daemon seam next\./);
  assert.match(markdown, /\[2026-03-20T07:58:00.000Z\] oracle: You still need better misclassification proof\./);
});
