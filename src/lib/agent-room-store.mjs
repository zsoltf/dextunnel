import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  defaultAgentRoomState,
  interruptAgentRoomRound,
  normalizeAgentRoomState
} from "./agent-room-state.mjs";

function sanitizeThreadId(threadId = "") {
  const normalized = String(threadId || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized || "thread";
}

export function createAgentRoomStore({
  baseDir,
  now = () => new Date().toISOString()
} = {}) {
  if (!baseDir) {
    throw new Error("createAgentRoomStore requires a baseDir.");
  }

  function filePathForThread(threadId) {
    return path.join(baseDir, `${sanitizeThreadId(threadId)}.json`);
  }

  async function load(threadId) {
    const id = String(threadId || "").trim();
    if (!id) {
      return defaultAgentRoomState();
    }

    try {
      const raw = JSON.parse(await readFile(filePathForThread(id), "utf8"));
      const normalized = normalizeAgentRoomState(raw, { threadId: id, timestamp: now() });
      if (normalized.currentRound?.status === "running") {
        return interruptAgentRoomRound(normalized, {
          note: "Council round stopped when Dextunnel restarted.",
          timestamp: now()
        });
      }
      return normalized;
    } catch {
      return defaultAgentRoomState({
        enabled: false,
        threadId: id,
        timestamp: now()
      });
    }
  }

  async function save(threadId, state) {
    const id = String(threadId || "").trim();
    if (!id) {
      return;
    }

    await mkdir(baseDir, { recursive: true });
    await writeFile(
      filePathForThread(id),
      JSON.stringify(normalizeAgentRoomState(state, { threadId: id, timestamp: now() }), null, 2),
      "utf8"
    );
  }

  return {
    filePathForThread,
    load,
    save
  };
}
