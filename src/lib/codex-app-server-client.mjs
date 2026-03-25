import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";

const DEFAULT_BINARY = "/Applications/Codex.app/Contents/Resources/codex";
const DEFAULT_LISTEN_URL = "ws://127.0.0.1:4321";
const SESSION_LOG_TAIL_BYTES = 1024 * 1024;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNoRolloutFoundError(message = "") {
  return /no rollout found for thread id/i.test(String(message || ""));
}

function sendInitializedNotification(socket) {
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "initialized",
      params: {}
    })
  );
}

function toTurnInput({
  text = "",
  attachments = []
} = {}) {
  const items = [];
  const trimmed = String(text || "").trim();

  if (trimmed) {
    items.push({
      type: "text",
      text: trimmed,
      text_elements: []
    });
  }

  for (const attachment of attachments || []) {
    if (attachment?.type === "localImage" && attachment.path) {
      items.push({
        type: "localImage",
        path: attachment.path
      });
      continue;
    }

    if (attachment?.type === "image" && attachment.url) {
      items.push({
        type: "image",
        url: attachment.url
      });
    }
  }

  return items;
}

function joinContent(content = []) {
  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text || "";
      }
      if (part.type === "image") {
        return "[image attachment]";
      }
      if (part.type === "localImage") {
        return "[local image attachment]";
      }
      if (part.type === "skill" || part.type === "mention") {
        return `[${part.type}] ${part.name || ""} ${part.path || ""}`.trim();
      }
      return `[${part.type || "content"}]`;
    })
    .filter(Boolean)
    .join("\n");
}

function joinSessionLogContent(content = []) {
  return content
    .map((part) => {
      if (part.type === "text" || part.type === "input_text" || part.type === "output_text") {
        return part.text || "";
      }

      if (
        part.type === "image" ||
        part.type === "input_image" ||
        part.type === "output_image" ||
        part.type === "localImage"
      ) {
        return "[image attachment]";
      }

      if (part.type === "local_image") {
        return "[local image attachment]";
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeTranscriptKey(role, kind, text) {
  return [role || "", kind || "", String(text || "").replace(/\s+/g, " ").trim().toLowerCase()].join("|");
}

function humanizeIdentifier(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function trimToolOutput(text, maxLength = 240) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return "";
  }

  const firstMeaningfulLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || normalized;

  if (firstMeaningfulLine.length <= maxLength) {
    return firstMeaningfulLine;
  }

  return `${firstMeaningfulLine.slice(0, maxLength - 3)}...`;
}

function readUtf8Tail(filePath, maxBytes = SESSION_LOG_TAIL_BYTES) {
  try {
    const fd = openSync(filePath, "r");

    try {
      const { size } = fstatSync(fd);
      const length = Math.min(size, maxBytes);
      if (length === 0) {
        return "";
      }

      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);

      let text = buffer.toString("utf8");
      if (size > length) {
        const firstNewline = text.indexOf("\n");
        text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
      }

      return text;
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

function readUtf8File(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function mapSessionLogEntry(entry) {
  if (entry.type === "response_item" && entry.payload?.type === "message") {
    return {
      role: entry.payload.role || "assistant",
      kind: entry.payload.phase || "message",
      text: joinSessionLogContent(entry.payload.content)
    };
  }

  if (
    entry.type === "response_item" &&
    (entry.payload?.type === "function_call_output" || entry.payload?.type === "custom_tool_call_output")
  ) {
    return {
      role: "tool",
      kind: "tool_output",
      text: trimToolOutput(entry.payload.output)
    };
  }

  if (entry.type === "compacted") {
    return {
      role: "system",
      kind: "context_compaction",
      text: "Context compacted."
    };
  }

  return null;
}

function parseTranscriptFromSessionLogText(text = "") {
  if (!text) {
    return [];
  }

  const transcript = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const mapped = mapSessionLogEntry(entry);
    if (!mapped?.text || !String(mapped.text).trim()) {
      continue;
    }

    transcript.push({
      role: mapped.role || "assistant",
      kind: mapped.kind || null,
      text: mapped.text,
      phase: mapped.kind || null,
      turnId: null,
      timestamp: entry.timestamp || null
    });
  }

  return transcript;
}

export function readTranscriptFromSessionLog(threadPath, {
  limit = null,
  maxBytes = SESSION_LOG_TAIL_BYTES
} = {}) {
  if (!threadPath) {
    return [];
  }

  const tail = readUtf8Tail(threadPath, maxBytes);
  if (!tail) {
    return [];
  }

  const transcript = parseTranscriptFromSessionLogText(tail);

  if (!limit || limit <= 0 || transcript.length <= limit) {
    return transcript;
  }

  return transcript.slice(-limit);
}

export function pageTranscriptEntries(transcript = [], {
  beforeIndex = null,
  limit = 40,
  visibleCount = null
} = {}) {
  const normalizedTranscript = Array.isArray(transcript) ? transcript : [];
  const totalCount = normalizedTranscript.length;
  if (totalCount === 0) {
    return {
      hasMore: false,
      items: [],
      nextBeforeIndex: null,
      totalCount: 0
    };
  }

  const parsedBeforeIndex = Number.parseInt(beforeIndex, 10);
  const parsedVisibleCount = Number.parseInt(visibleCount, 10);
  let endExclusive = totalCount;

  if (Number.isFinite(parsedBeforeIndex) && parsedBeforeIndex >= 0) {
    endExclusive = Math.max(0, Math.min(totalCount, parsedBeforeIndex));
  } else if (Number.isFinite(parsedVisibleCount) && parsedVisibleCount >= 0) {
    endExclusive = Math.max(0, totalCount - parsedVisibleCount);
  }

  if (endExclusive <= 0) {
    return {
      hasMore: false,
      items: [],
      nextBeforeIndex: null,
      totalCount
    };
  }

  const pageSize = Math.max(1, Number.parseInt(limit, 10) || 40);
  const start = Math.max(0, endExclusive - pageSize);

  return {
    hasMore: start > 0,
    items: normalizedTranscript.slice(start, endExclusive),
    nextBeforeIndex: start > 0 ? start : null,
    totalCount
  };
}

export function readTranscriptHistoryPageFromSessionLog(threadPath, {
  beforeIndex = null,
  limit = 40,
  visibleCount = null
} = {}) {
  if (!threadPath) {
    return {
      hasMore: false,
      items: [],
      nextBeforeIndex: null,
      totalCount: 0
    };
  }

  return pageTranscriptEntries(
    parseTranscriptFromSessionLogText(readUtf8File(threadPath)),
    {
      beforeIndex,
      limit,
      visibleCount
    }
  );
}

export function buildSessionLogSnapshot(thread, {
  limit = 40,
  maxBytes = SESSION_LOG_TAIL_BYTES
} = {}) {
  const transcript = readTranscriptFromSessionLog(thread?.path, {
    limit,
    maxBytes
  });

  return {
    thread: {
      id: thread?.id || null,
      name: thread?.name || null,
      preview: thread?.preview || null,
      source: thread?.source || null,
      cwd: thread?.cwd || null,
      status: thread?.status || null,
      activeTurnId: thread?.activeTurnId || null,
      activeTurnStatus: thread?.activeTurnStatus || null,
      livePlan: thread?.livePlan || null,
      lastTurnId: thread?.lastTurnId || null,
      lastTurnStatus: thread?.lastTurnStatus || null,
      tokenUsage: thread?.tokenUsage || null,
      updatedAt: thread?.updatedAt || null,
      path: thread?.path || null
    },
    transcript,
    transcriptCount: transcript.length
  };
}

function buildTimestampQueues(threadPath) {
  const tail = readUtf8Tail(threadPath);
  if (!tail) {
    return new Map();
  }

  const queues = new Map();

  for (const line of tail.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const mapped = mapSessionLogEntry(entry);
    if (!mapped?.text) {
      continue;
    }

    const key = normalizeTranscriptKey(mapped.role, mapped.kind, mapped.text);
    const queue = queues.get(key) || [];
    queue.push(entry.timestamp || null);
    queues.set(key, queue);
  }

  return queues;
}

function enrichTranscriptTimestamps(thread, transcript) {
  if (!thread?.path) {
    return transcript;
  }

  const queues = buildTimestampQueues(thread.path);
  if (queues.size === 0) {
    return transcript;
  }

  return transcript.map((entry) => {
    if (entry.timestamp) {
      return entry;
    }

    const key = normalizeTranscriptKey(entry.role, entry.kind, entry.text);
    const queue = queues.get(key);
    if (!queue?.length) {
      return entry;
    }

    return {
      ...entry,
      timestamp: queue.shift()
    };
  });
}

function joinReasoningSummary(summary = []) {
  return summary
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part?.text) {
        return part.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function summarizeUnknownItem(item) {
  const summary = {};

  for (const key of ["status", "command", "tool", "message", "output", "stdout", "stderr"]) {
    if (item[key] != null) {
      summary[key] = item[key];
    }
  }

  if (Object.keys(summary).length === 0) {
    return `${humanizeIdentifier(item.type || "item")} event`;
  }

  return `${item.type || "item"}: ${JSON.stringify(summary)}`;
}

function describeServerRequest(msg) {
  switch (msg.method) {
    case "account/chatgptAuthTokens/refresh":
      return "app-server requested ChatGPT auth token refresh; the standalone Dextunnel bridge cannot satisfy that yet.";
    case "item/commandExecution/requestApproval":
      return "app-server requested command approval; the standalone Dextunnel bridge does not support live approval callbacks yet.";
    case "item/fileChange/requestApproval":
      return "app-server requested file-change approval; the standalone Dextunnel bridge does not support live approval callbacks yet.";
    case "item/permissions/requestApproval":
      return "app-server requested additional permissions; the standalone Dextunnel bridge does not support that approval flow yet.";
    case "item/tool/requestUserInput":
      return "app-server requested tool user input; the standalone Dextunnel bridge does not support that interaction yet.";
    case "mcpServer/elicitation/request":
      return "app-server requested MCP elicitation input; the standalone Dextunnel bridge does not support that interaction yet.";
    case "item/tool/call":
      return "app-server requested a client-side dynamic tool call; the standalone Dextunnel bridge does not implement client tools yet.";
    default:
      return `app-server sent an unsupported server request: ${msg.method}`;
  }
}

export function mapThreadItemToCompanionEntry(item, turn) {
  switch (item.type) {
    case "userMessage":
      return {
        itemId: item.id || null,
        role: "user",
        kind: "message",
        text: joinContent(item.content),
        phase: null,
        turnId: turn.id,
        timestamp: turn.updatedAt || turn.startedAt || null
      };
    case "agentMessage":
      return {
        itemId: item.id || null,
        role: "assistant",
        kind: item.phase || "message",
        text: item.text || "",
        phase: item.phase || null,
        turnId: turn.id,
        timestamp: turn.updatedAt || turn.startedAt || null
      };
    case "commandExecution":
      const outputPreview = trimToolOutput(item.output || "");
      return {
        itemId: item.id || null,
        role: "tool",
        kind: "command",
        text: [item.command ? `$ ${item.command}` : null, outputPreview || null].filter(Boolean).join("\n"),
        phase: item.status || null,
        turnId: turn.id,
        timestamp: turn.updatedAt || turn.startedAt || null
      };
    case "reasoning":
      return {
        itemId: item.id || null,
        role: "system",
        kind: "reasoning",
        text: joinReasoningSummary(item.summary),
        phase: null,
        turnId: turn.id,
        timestamp: turn.updatedAt || turn.startedAt || null
      };
    case "contextCompaction":
      return {
        itemId: item.id || null,
        role: "system",
        kind: "context_compaction",
        text: "Context compacted.",
        phase: null,
        turnId: turn.id,
        timestamp: turn.updatedAt || turn.startedAt || null
      };
    case "mcpToolCall":
    case "dynamicToolCall":
    case "collabToolCall":
    case "fileChange":
      return {
        itemId: item.id || null,
        role: "tool",
        kind: item.type,
        text: summarizeUnknownItem(item),
        phase: item.status || null,
        turnId: turn.id,
        timestamp: turn.updatedAt || turn.startedAt || null
      };
    default:
      return {
        itemId: item.id || null,
        role: "system",
        kind: item.type || "event",
        text: summarizeUnknownItem(item),
        phase: null,
        turnId: turn.id,
        timestamp: turn.updatedAt || turn.startedAt || null
      };
  }
}

export function mapThreadToCompanionSnapshot(thread, { limit = null } = {}) {
  const turns = thread.turns || [];
  const activeTurn = [...turns].reverse().find((turn) => turn.status === "inProgress") || null;
  const lastTurn = turns.at(-1) || null;
  const transcript = enrichTranscriptTimestamps(
    thread,
    turns
      .flatMap((turn) => (turn.items || []).map((item) => mapThreadItemToCompanionEntry(item, turn)))
      .filter((entry) => entry.text && entry.text.trim().length > 0)
  );
  const visibleTranscript = limit ? transcript.slice(-limit) : transcript;

  return {
    thread: {
      id: thread.id,
      name: thread.name || null,
      preview: thread.preview || null,
      source: thread.source || null,
      cwd: thread.cwd || null,
      status: thread.status || null,
      activeTurnId: activeTurn?.id || null,
      activeTurnStatus: activeTurn?.status || null,
      livePlan: activeTurn?.plan || lastTurn?.plan || null,
      lastTurnId: lastTurn?.id || null,
      lastTurnStatus: lastTurn?.status || null,
      tokenUsage: thread.tokenUsage || null,
      updatedAt: thread.updatedAt || null,
      path: thread.path || null
    },
    transcript: visibleTranscript,
    transcriptCount: transcript.length
  };
}

function buildSnapshotFromNotifications(thread, turn, notifications, { limit = 40 } = {}) {
  const priorTurns = Array.isArray(thread?.turns) ? thread.turns.filter((entry) => entry.id !== turn?.id) : [];
  const turnItems = notifications
    .filter((msg) => msg.method === "item/completed" && msg.params?.turnId === turn?.id && msg.params?.item)
    .map((msg) => msg.params.item);
  const synthesizedTurn = turn
    ? {
        ...turn,
        items: turnItems
      }
    : null;

  return mapThreadToCompanionSnapshot(
    {
      ...thread,
      turns: synthesizedTurn ? [...priorTurns, synthesizedTurn] : priorTurns
    },
    { limit }
  );
}

export function getWritableTurnStrategy(thread) {
  const turns = thread.turns || [];
  const activeTurn = [...turns].reverse().find((turn) => turn.status === "inProgress") || null;

  if (activeTurn) {
    return {
      mode: "steer",
      expectedTurnId: activeTurn.id
    };
  }

  return {
    mode: "start",
    expectedTurnId: null
  };
}

export function createCodexAppServerBridge({
  binaryPath = DEFAULT_BINARY,
  listenUrl = DEFAULT_LISTEN_URL,
  clientInfo = { name: "dextunnel", version: "0.1.0" },
  fetchImpl = fetch,
  spawnImpl = spawn,
  WebSocketImpl = WebSocket
} = {}) {
  const readyUrl = new URL(listenUrl.replace(/^ws/, "http"));
  readyUrl.pathname = "/readyz";

  let child = null;
  let startPromise = null;
  let startupLogs = [];
  let lastError = null;

  function appendLog(line) {
    if (!line) {
      return;
    }
    startupLogs.push(line);
    startupLogs = startupLogs.slice(-40);
  }

  async function isReady() {
    try {
      const response = await fetchImpl(readyUrl, { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function ensureStarted() {
    if (await isReady()) {
      return;
    }

    if (startPromise) {
      return startPromise;
    }

    startPromise = (async () => {
      if (await isReady()) {
        return;
      }

      lastError = null;
      child = spawnImpl(binaryPath, ["app-server", "--listen", listenUrl], {
        stdio: ["ignore", "pipe", "pipe"]
      });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => appendLog(chunk.trim()));
      child.stderr.on("data", (chunk) => appendLog(chunk.trim()));
      child.on("exit", (code, signal) => {
        appendLog(`app-server exited with code=${code} signal=${signal}`);
        child = null;
      });

      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        if (await isReady()) {
          return;
        }
        if (child && child.exitCode != null) {
          throw new Error(`codex app-server exited early with code ${child.exitCode}`);
        }
        await delay(150);
      }

      throw new Error("Timed out waiting for codex app-server readiness.");
    })()
      .catch((error) => {
        lastError = error.message;
        throw error;
      })
      .finally(() => {
        startPromise = null;
      });

    return startPromise;
  }

  async function rpc(method, params) {
    await ensureStarted();

    return new Promise((resolve, reject) => {
      let stage = "init";
      let settled = false;
      const initId = 1;
      const requestId = 2;
      const notifications = [];
      const ws = new WebSocketImpl(listenUrl);

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error(`Timed out waiting for ${method} response.`));
        }
      }, 6000);

      function finish(fn) {
        return (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {
            // Ignore close failures on teardown.
          }
          fn(value);
        };
      }

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              clientInfo,
              capabilities: {
                experimentalApi: true
              }
            }
          })
        );
      });

      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data.toString());

        if (msg.method) {
          notifications.push(msg);

          if (msg.id != null) {
            finish(reject)(new Error(describeServerRequest(msg)));
          }
          return;
        }

        if (msg.error) {
          finish(reject)(new Error(msg.error.message || `RPC error calling ${method}`));
          return;
        }

        if (msg.id === initId && stage === "init") {
          stage = "request";
          sendInitializedNotification(ws);
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: requestId,
              method,
              params
            })
          );
          return;
        }

        if (msg.id === requestId) {
          finish(resolve)({
            result: msg.result,
            notifications
          });
        }
      });

      ws.addEventListener("error", () => {
        finish(reject)(new Error(`WebSocket transport error while calling ${method}.`));
      });
    });
  }

  async function listThreads({
    cwd = null,
    limit = 10,
    archived = false,
    sourceKinds = null
  } = {}) {
    const params = {
      cwd,
      limit,
      archived,
      sortKey: "updated_at"
    };

    if (Array.isArray(sourceKinds) && sourceKinds.length > 0) {
      params.sourceKinds = sourceKinds;
    }

    const { result } = await rpc("thread/list", params);
    return result.data || [];
  }

  async function readThread(threadId, includeTurns = true) {
    const { result } = await rpc("thread/read", {
      threadId,
      includeTurns
    });
    return result.thread;
  }

  async function getLatestThreadForCwd(cwd) {
    const threads = await listThreads({ cwd, limit: 1, archived: false });
    if (threads.length === 0) {
      return null;
    }

    return readThread(threads[0].id, true);
  }

  async function resumeThread({
    threadId,
    cwd = null,
    persistExtendedHistory = true
  }) {
    const { result } = await rpc("thread/resume", {
      threadId,
      cwd,
      persistExtendedHistory
    });
    return result.thread;
  }

  async function startThread({
    cwd = process.cwd(),
    approvalPolicy = "never",
    sandbox = "workspace-write",
    ephemeral = false,
    persistExtendedHistory = true
  } = {}) {
    const { result } = await rpc("thread/start", {
      cwd,
      approvalPolicy,
      sandbox,
      ephemeral,
      experimentalRawEvents: false,
      persistExtendedHistory
    });
    return result.thread;
  }

  async function startTurn({
    threadId,
    text,
    attachments = [],
    approvalPolicy = "never"
  }) {
    const { result } = await rpc("turn/start", {
      threadId,
      input: toTurnInput({ text, attachments }),
      approvalPolicy
    });
    return result.turn;
  }

  async function steerTurn({
    threadId,
    expectedTurnId,
    text,
    attachments = []
  }) {
    const { result } = await rpc("turn/steer", {
      threadId,
      expectedTurnId,
      input: toTurnInput({ text, attachments })
    });
    return result.turn;
  }

  async function interruptTurn({
    threadId,
    turnId
  }) {
    const { result } = await rpc("turn/interrupt", {
      threadId,
      turnId
    });
    return result;
  }

  async function watchThread({
    threadId,
    cwd = null,
    onClose = null,
    onError = null,
    onReady = null,
    onServerRequest = null,
    onNotification = null
  }) {
    await ensureStarted();

    return new Promise((resolve, reject) => {
      let closed = false;
      let initialized = false;
      const initId = 1;
      const resumeId = 2;
      const ws = new WebSocketImpl(listenUrl);

      function send(payload) {
        if (closed || ws.readyState !== WebSocket.OPEN) {
          throw new Error("Thread watcher socket is not open.");
        }

        ws.send(JSON.stringify(payload));
      }

      function close() {
        if (closed) {
          return;
        }

        closed = true;
        try {
          ws.close();
        } catch {
          // Ignore close failures during teardown.
        }
      }

      function respond(requestId, result) {
        send({
          jsonrpc: "2.0",
          id: requestId,
          result
        });
      }

      function respondError(requestId, message, code = -32000) {
        send({
          jsonrpc: "2.0",
          id: requestId,
          error: {
            code,
            message
          }
        });
      }

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              clientInfo,
              capabilities: {
                experimentalApi: true
              }
            }
          })
        );
      });

      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data.toString());

        if (msg.method) {
          if (msg.id != null) {
            onServerRequest?.({
              method: msg.method,
              params: msg.params || {},
              requestId: msg.id,
              respond,
              respondError
            });
            return;
          }

          onNotification?.({
            method: msg.method,
            params: msg.params || {}
          });
          return;
        }

        if (msg.error) {
          const error = new Error(msg.error.message || "Thread watch RPC failed.");

          if (!initialized) {
            reject(error);
            return;
          }

          onError?.(error);
          return;
        }

        if (msg.id === initId && !initialized) {
          sendInitializedNotification(ws);
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: resumeId,
              method: "thread/resume",
              params: {
                threadId,
                cwd,
                persistExtendedHistory: true
              }
            })
          );
          return;
        }

        if (msg.id === resumeId && !initialized) {
          initialized = true;
          const controller = {
            close,
            respond,
            respondError
          };
          onReady?.(msg.result?.thread || null, controller);
          resolve(controller);
        }
      });

      ws.addEventListener("close", () => {
        const wasInitialized = initialized;
        close();

        if (!wasInitialized) {
          reject(new Error(`Thread watcher closed before subscribing to ${threadId}.`));
          return;
        }

        onClose?.();
      });

      ws.addEventListener("error", () => {
        const error = new Error(`WebSocket transport error while watching thread ${threadId}.`);

        if (!initialized) {
          reject(error);
          return;
        }

        onError?.(error);
      });
    });
  }

  async function runTurnSession({
    threadId = null,
    cwd = process.cwd(),
    text,
    attachments = [],
    createThreadIfMissing = true,
    allowSteer = false,
    approvalPolicy = "never",
    timeoutMs = 120000,
    waitForAcceptanceOnly = false
  }) {
    await ensureStarted();

    return new Promise((resolve, reject) => {
      let settled = false;
      let stage = "init";
      let targetThread = null;
      let mode = null;
      let requestResult = null;
      let activeTurnId = null;
      let completedTurn = null;
      let snapshotRequested = false;
      const initId = 1;
      const threadSetupId = 2;
      const turnRequestId = 3;
      const snapshotReadId = 4;
      const notifications = [];
      const ws = new WebSocketImpl(listenUrl);

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(
            new Error(
              `Timed out waiting for app-server turn completion${targetThread?.id ? ` on thread ${targetThread.id}` : ""}.`
            )
          );
        }
      }, timeoutMs);

      function finish(fn) {
        return (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {
            // Ignore close failures on teardown.
          }
          fn(value);
        };
      }

      function sendThreadSetupRequest() {
        if (threadId) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: threadSetupId,
              method: "thread/resume",
              params: {
                threadId,
                cwd,
                persistExtendedHistory: true
              }
            })
          );
          return;
        }

        if (!createThreadIfMissing) {
          finish(reject)(new Error(`No Codex thread found for ${cwd}.`));
          return;
        }

        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: threadSetupId,
            method: "thread/start",
            params: {
              cwd,
              approvalPolicy,
              sandbox: "workspace-write",
              ephemeral: false,
              experimentalRawEvents: false,
              persistExtendedHistory: true
            }
          })
        );
      }

      function sendTurnRequest() {
        const params =
          mode === "steer"
            ? {
                threadId: targetThread.id,
                expectedTurnId: activeTurnId,
                input: toTurnInput({ text, attachments })
              }
            : {
                threadId: targetThread.id,
                input: toTurnInput({ text, attachments }),
                approvalPolicy
              };

        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: turnRequestId,
            method: mode === "steer" ? "turn/steer" : "turn/start",
            params
          })
        );
      }

      function fallbackToDirectTurnStart() {
        if (!threadId) {
          return false;
        }

        targetThread = targetThread || {
          cwd,
          id: threadId,
          turns: []
        };
        mode = "start";
        activeTurnId = null;
        stage = "turn";
        sendTurnRequest();
        return true;
      }

      function requestFinalSnapshot(turn = null) {
        if (snapshotRequested) {
          return;
        }

        snapshotRequested = true;
        completedTurn = turn || completedTurn;
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: snapshotReadId,
            method: "thread/read",
            params: {
              threadId: targetThread.id,
              includeTurns: true
            }
          })
        );
      }

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              clientInfo,
              capabilities: {
                experimentalApi: true
              }
            }
          })
        );
      });

      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data.toString());

        if (msg.method) {
          notifications.push(msg);

          if (msg.id != null) {
            finish(reject)(new Error(describeServerRequest(msg)));
            return;
          }

          if (msg.method === "turn/started" && msg.params?.turn?.id) {
            activeTurnId = msg.params.turn.id;
            return;
          }

          if (msg.method === "turn/completed") {
            const completedTurnId = msg.params?.turn?.id || null;
            if (!activeTurnId || completedTurnId === activeTurnId) {
              requestFinalSnapshot(msg.params?.turn || null);
            }
          }
          return;
        }

        if (msg.error) {
          if (msg.id === threadSetupId && isNoRolloutFoundError(msg.error.message || "")) {
            if (fallbackToDirectTurnStart()) {
              return;
            }
          }
          if (msg.id === snapshotReadId && completedTurn) {
            finish(resolve)({
              mode,
              thread: targetThread,
              notifications,
              result: requestResult,
              turn: completedTurn
            });
            return;
          }

          finish(reject)(new Error(msg.error.message || `RPC error during ${mode} turn`));
          return;
        }

        if (msg.id === initId && stage === "init") {
          stage = "thread";
          sendInitializedNotification(ws);
          sendThreadSetupRequest();
          return;
        }

        if (msg.id === threadSetupId) {
          targetThread = msg.result?.thread || null;
          if (!targetThread?.id) {
            finish(reject)(new Error("app-server did not return a thread for write setup."));
            return;
          }

          const strategy = getWritableTurnStrategy(targetThread);
          mode = strategy.mode;
          activeTurnId = strategy.expectedTurnId;

          if (mode === "steer" && !allowSteer) {
            finish(reject)(
              new Error(
                `Thread ${targetThread.id} already has an active turn (${activeTurnId}). Wait for completion before sending a new message.`
              )
            );
            return;
          }

          stage = "turn";
          sendTurnRequest();
          return;
        }

        if (msg.id === turnRequestId) {
          requestResult = msg.result;
          activeTurnId = msg.result?.turn?.id || activeTurnId;
          if (waitForAcceptanceOnly) {
            finish(resolve)({
              mode,
              thread: targetThread,
              notifications,
              result: requestResult,
              turn: msg.result?.turn || null
            });
            return;
          }
          requestFinalSnapshot(msg.result?.turn || null);
          return;
        }

        if (msg.id === snapshotReadId) {
          const threadWithTurns = msg.result?.thread || targetThread;
          const finalTurnId = completedTurn?.id || activeTurnId;
          const finalTurn =
            (threadWithTurns?.turns || []).find((entry) => entry.id === finalTurnId) || completedTurn || null;

          finish(resolve)({
            mode,
            thread: threadWithTurns,
            notifications,
            result: requestResult,
            turn: finalTurn
          });
          return;
        }

      });

      ws.addEventListener("error", () => {
        finish(reject)(new Error(`WebSocket transport error during ${mode} turn.`));
      });
    });
  }

  async function waitForTurnCompletion(threadId, turnId, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const thread = await readThread(threadId, true);
        const turn = (thread.turns || []).find((entry) => entry.id === turnId) || null;

        if (turn && turn.status !== "inProgress") {
          return {
            thread,
            turn
          };
        }
      } catch (error) {
        if (!String(error.message).includes("not materialized yet")) {
          throw error;
        }
      }

      await delay(1200);
    }

    throw new Error(`Timed out waiting for turn ${turnId} to complete.`);
  }

  async function sendText({
    threadId = null,
    cwd = process.cwd(),
    text,
    attachments = [],
    createThreadIfMissing = true,
    allowSteer = false,
    timeoutMs = 45000,
    waitForCompletion = true
  }) {
    const trimmed = String(text || "").trim();
    if (!trimmed && (!Array.isArray(attachments) || attachments.length === 0)) {
      throw new Error("Message cannot be empty.");
    }

    let targetThreadId = threadId;

    if (!targetThreadId) {
      const latestThread = await getLatestThreadForCwd(cwd);
      targetThreadId = latestThread?.id || null;
    }
    if (!targetThreadId && !createThreadIfMissing) {
      throw new Error(`No Codex thread found for ${cwd}.`);
    }

    const session = await runTurnSession({
      threadId: targetThreadId,
      cwd,
      text: trimmed,
      attachments,
      createThreadIfMissing,
      allowSteer,
      approvalPolicy: "never",
      timeoutMs,
      waitForAcceptanceOnly: !waitForCompletion
    });
    const turnId = session.turn?.id || session.result?.turn?.id;
    if (!turnId) {
      throw new Error("app-server did not report a turn id for the submitted message.");
    }

    if (!waitForCompletion) {
      const lightweightThread = await readThread(session.thread.id, false).catch(() => session.thread);
      const sessionLogSnapshot = buildSessionLogSnapshot(lightweightThread, { limit: 40, maxBytes: 64 * 1024 });

      return {
        mode: session.mode,
        thread: lightweightThread,
        turn: session.result?.turn || session.turn || null,
        snapshot:
          sessionLogSnapshot.transcriptCount > 0
            ? sessionLogSnapshot
            : buildSnapshotFromNotifications(session.thread, session.result?.turn || session.turn || null, session.notifications, { limit: 40 })
      };
    }

    const finalTurnFromSession =
      (session.thread?.turns || []).find((entry) => entry.id === turnId) || session.turn || null;

    if (finalTurnFromSession?.status === "inProgress" || session.result?.turn?.status === "inProgress") {
      return {
        mode: session.mode,
        thread: session.thread,
        turn: finalTurnFromSession || session.result?.turn || null,
        snapshot:
          session.thread?.turns
            ? mapThreadToCompanionSnapshot(session.thread, { limit: 40 })
            : buildSnapshotFromNotifications(session.thread, session.result?.turn || finalTurnFromSession, session.notifications, { limit: 40 })
      };
    }

    let completed = null;

    if (finalTurnFromSession && finalTurnFromSession.status !== "inProgress") {
      completed = {
        thread: session.thread,
        turn: finalTurnFromSession
      };
    } else {
      completed = await waitForTurnCompletion(session.thread.id, turnId, timeoutMs);
    }

    return {
      mode: session.mode,
      thread: completed.thread,
      turn: completed.turn,
      snapshot:
        (completed.thread?.turns || []).some((entry) => entry.id === completed.turn.id)
          ? mapThreadToCompanionSnapshot(completed.thread, { limit: 40 })
          : buildSnapshotFromNotifications(session.thread, completed.turn, session.notifications, { limit: 40 })
    };
  }

  async function dispose() {
    if (!child) {
      return;
    }

    child.kill("SIGINT");
    try {
      await once(child, "exit");
    } catch {
      // Ignore shutdown races.
    }
    child = null;
  }

  return {
    dispose,
    ensureStarted,
    getLatestThreadForCwd,
    getWritableTurnStrategy,
    getStatus() {
      return {
        binaryPath,
        listenUrl,
        readyUrl: readyUrl.toString(),
        started: Boolean(child),
        pid: child?.pid || null,
        startupLogs,
        lastError
      };
    },
    listThreads,
    interruptTurn,
    readThread,
    rpc,
    runTurnSession,
    resumeThread,
    sendText,
    startThread,
    startTurn,
    steerTurn,
    watchThread,
    waitForTurnCompletion
  };
}
