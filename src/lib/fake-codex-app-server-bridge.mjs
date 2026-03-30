import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { mapThreadToCompanionSnapshot } from "./codex-app-server-client.mjs";

function nowIso() {
  return new Date().toISOString();
}

function defaultThreads(cwd) {
  const timestamp = nowIso();
  return [
    {
      cwd,
      id: "thr_dextunnel",
      name: "dextunnel",
      path: `${cwd}/.codex/fake-dextunnel.jsonl`,
      preview: "Semantic companion thread",
      source: "vscode",
      status: "idle",
      tokenUsage: null,
      turns: [
        {
          id: "turn_dextunnel_1",
          items: [
            {
              content: [{ text: "keep going on dextunnel", type: "text" }],
              id: "item_user_1",
              type: "userMessage"
            },
            {
              id: "item_agent_1",
              phase: "message",
              text: "Dextunnel fake bridge ready.",
              type: "agentMessage"
            }
          ],
          startedAt: timestamp,
          status: "completed",
          updatedAt: timestamp
        }
      ],
      updatedAt: timestamp
    },
    {
      cwd,
      id: "thr_marketing",
      name: "marketing",
      path: `${cwd}/.codex/fake-marketing.jsonl`,
      preview: "Marketing side thread",
      source: "vscode",
      status: "idle",
      tokenUsage: null,
      turns: [
        {
          id: "turn_marketing_1",
          items: [
            {
              content: [{ text: "review marketing notes", type: "text" }],
              id: "item_marketing_user_1",
              type: "userMessage"
            },
            {
              id: "item_marketing_agent_1",
              phase: "message",
              text: "Marketing thread ready.",
              type: "agentMessage"
            }
          ],
          startedAt: timestamp,
          status: "completed",
          updatedAt: timestamp
        }
      ],
      updatedAt: timestamp
    }
  ];
}

export function createFakeCodexAppServerBridge({
  cwd = process.cwd(),
  binaryPath = "fake-codex",
  listenUrl = "ws://fake-codex-app-server",
  sendDelayMs = 0
} = {}) {
  const threadsById = new Map(defaultThreads(cwd).map((thread) => [thread.id, structuredClone(thread)]));
  const watchersByThreadId = new Map();

  function listAllThreads() {
    return [...threadsById.values()].sort((left, right) => {
      const leftTime = new Date(left.updatedAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || 0).getTime();
      return rightTime - leftTime;
    });
  }

  function summarizeThread(thread) {
    return {
      cwd: thread.cwd || null,
      id: thread.id,
      name: thread.name || null,
      path: thread.path || null,
      preview: thread.preview || null,
      source: thread.source || null,
      status: thread.status || null,
      updatedAt: thread.updatedAt || null
    };
  }

  function getThread(threadId) {
    const thread = threadsById.get(threadId);
    return thread ? structuredClone(thread) : null;
  }

  function updateThread(threadId, updater) {
    const current = threadsById.get(threadId);
    if (!current) {
      return null;
    }

    const next = updater(structuredClone(current));
    threadsById.set(threadId, next);
    return structuredClone(next);
  }

  async function listThreads({
    cwd: requestedCwd = null,
    limit = 10,
    sourceKinds = null
  } = {}) {
    let threads = listAllThreads();
    if (requestedCwd) {
      threads = threads.filter((thread) => thread.cwd === requestedCwd);
    }
    if (Array.isArray(sourceKinds) && sourceKinds.length) {
      threads = threads.filter((thread) => sourceKinds.includes(thread.source));
    }
    return threads.slice(0, limit).map(summarizeThread);
  }

  async function readThread(threadId) {
    return getThread(threadId);
  }

  async function getLatestThreadForCwd(requestedCwd) {
    const threads = await listThreads({ cwd: requestedCwd, limit: 1 });
    if (threads.length === 0) {
      return null;
    }
    return readThread(threads[0].id);
  }

  async function listModels() {
    return {
      data: [
        {
          id: "gpt-5.4",
          model: "gpt-5.4",
          displayName: "GPT-5.4",
          hidden: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Lower latency" },
            { reasoningEffort: "medium", description: "Balanced" },
            { reasoningEffort: "high", description: "More deliberate" },
            { reasoningEffort: "xhigh", description: "Deepest reasoning" }
          ],
          inputModalities: ["text", "image"],
          supportsPersonality: true,
          isDefault: true
        },
        {
          id: "gpt-5.4-mini",
          model: "gpt-5.4-mini",
          displayName: "GPT-5.4 Mini",
          hidden: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Lower latency" },
            { reasoningEffort: "medium", description: "Balanced" },
            { reasoningEffort: "high", description: "More deliberate" }
          ],
          inputModalities: ["text", "image"],
          supportsPersonality: true,
          isDefault: false
        }
      ],
      nextCursor: null
    };
  }

  async function startThread({
    cwd: threadCwd = cwd
  } = {}) {
    const id = `thr_${randomUUID().slice(0, 8)}`;
    const timestamp = nowIso();
    const thread = {
      cwd: threadCwd,
      id,
      name: "new session",
      path: `${threadCwd}/.codex/${id}.jsonl`,
      preview: null,
      source: "vscode",
      status: "idle",
      tokenUsage: null,
      turns: [],
      updatedAt: timestamp
    };
    threadsById.set(id, thread);
    return summarizeThread(thread);
  }

  async function sendText({
    threadId = null,
    cwd: threadCwd = cwd,
    text = "",
    attachments = [],
    model = null,
    effort = null,
    createThreadIfMissing = true
  } = {}) {
    let nextThreadId = threadId;

    if (!nextThreadId) {
      if (!createThreadIfMissing) {
        throw new Error("No fake thread selected.");
      }
      const created = await startThread({ cwd: threadCwd });
      nextThreadId = created.id;
    }

    if (Number.isFinite(sendDelayMs) && sendDelayMs > 0) {
      await delay(sendDelayMs);
    }

    const timestamp = nowIso();
    const assistantText = text
      ? `FAKE_BRIDGE_ACK: ${String(text).trim()}`
      : `FAKE_BRIDGE_ACK: ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`;
    const turnId = `turn_${randomUUID().slice(0, 8)}`;
    const nextThread = updateThread(nextThreadId, (thread) => {
      const turn = {
        id: turnId,
        items: [
          {
            content: text ? [{ text: String(text).trim(), type: "text" }] : [],
            id: `item_user_${randomUUID().slice(0, 8)}`,
            type: "userMessage"
          },
          {
            id: `item_agent_${randomUUID().slice(0, 8)}`,
            phase: "message",
            text: assistantText,
            type: "agentMessage",
            meta: {
              effort: typeof effort === "string" && effort.trim() ? effort.trim() : null,
              model: typeof model === "string" && model.trim() ? model.trim() : null
            }
          }
        ],
        startedAt: timestamp,
        status: "completed",
        updatedAt: timestamp
      };
      return {
        ...thread,
        cwd: thread.cwd || threadCwd,
        preview: assistantText,
        status: "idle",
        turns: [...(thread.turns || []), turn],
        updatedAt: timestamp
      };
    });

    const watcher = watchersByThreadId.get(nextThreadId);
    watcher?.onNotification?.({
      method: "turn/started",
      params: {
        threadId: nextThreadId,
        turn: {
          id: turnId
        }
      }
    });
    watcher?.onNotification?.({
      method: "turn/completed",
      params: {
        threadId: nextThreadId,
        turn: {
          id: turnId
        }
      }
    });

    return {
      mode: "start",
      snapshot: mapThreadToCompanionSnapshot(nextThread, { limit: 60 }),
      thread: summarizeThread(nextThread),
      turn: {
        id: turnId,
        status: "completed"
      }
    };
  }

  async function interruptTurn() {
    return { ok: true };
  }

  async function watchThread({
    threadId,
    onClose,
    onReady
  } = {}) {
    let closed = false;
    const watcher = {
      close() {
        if (closed) {
          return;
        }
        closed = true;
        watchersByThreadId.delete(threadId);
        onClose?.();
      },
      onClose,
      onNotification() {},
      onReady,
      onServerRequest() {},
      respond() {},
      respondError() {}
    };

    watchersByThreadId.set(threadId, watcher);
    queueMicrotask(() => {
      if (!closed) {
        onReady?.();
      }
    });

    return watcher;
  }

  return {
    async dispose() {},
    async ensureStarted() {},
    getLatestThreadForCwd,
    getStatus() {
      return {
        binaryPath,
        lastError: null,
        listenUrl,
        pid: 0,
        readyUrl: "http://fake-codex-app-server/readyz",
        started: true,
        startupLogs: ["fake bridge ready"]
      };
    },
    async interruptTurn(args) {
      return interruptTurn(args);
    },
    listModels,
    listThreads,
    readThread,
    async resumeThread(threadId) {
      return summarizeThread(await readThread(threadId));
    },
    async rpc() {
      throw new Error("Fake bridge does not expose raw RPC.");
    },
    async runTurnSession() {
      throw new Error("Fake bridge does not expose raw turn sessions.");
    },
    sendText,
    startThread,
    async startTurn() {
      throw new Error("Fake bridge does not expose startTurn directly.");
    },
    async steerTurn() {
      throw new Error("Fake bridge does not expose steerTurn directly.");
    },
    watchThread,
    async waitForTurnCompletion() {
      return { status: "completed" };
    }
  };
}
