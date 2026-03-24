import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  AGENT_ROOM_MEMBER_IDS,
  defaultAgentRoomState,
  getAgentRoomRetryRound,
  interruptAgentRoomRound,
  normalizeAgentRoomState,
  createAgentRoomMessage,
  setAgentRoomEnabled,
  settleAgentRoomParticipant,
  startAgentRoomRound
} from "./lib/agent-room-state.mjs";
import { createAgentRoomContextBuilder } from "./lib/agent-room-context.mjs";
import { createAgentRoomService } from "./lib/agent-room-service.mjs";
import { createAgentRoomStore } from "./lib/agent-room-store.mjs";
import { createAgentRoomRuntime } from "./lib/agent-room-runtime.mjs";
import { createAttachmentService } from "./lib/attachment-service.mjs";
import { handleBridgeApiRequest } from "./lib/bridge-api-handler.mjs";
import { createBridgeStatusBuilder } from "./lib/bridge-status-builder.mjs";
import {
  ARAZZO_DOC_PATH,
  DISCOVERY_MANIFEST_PATH,
  LLMS_TXT_PATH,
  OPENAPI_DOC_PATH,
  buildArazzoDocument,
  buildLlmsText,
  buildOpenApiDocument,
  buildWellKnownManifest
} from "./lib/discovery-docs.mjs";
import {
  buildSessionLogSnapshot,
  mapThreadItemToCompanionEntry,
  mapThreadToCompanionSnapshot,
  pageTranscriptEntries,
  readTranscriptHistoryPageFromSessionLog,
  readTranscriptFromSessionLog
} from "./lib/codex-app-server-client.mjs";
import {
  APP_SERVER_LIVE_PATCH_NOTIFICATION_METHODS
} from "./lib/app-server-contract.mjs";
import { createCodexRuntime } from "./lib/app-server-runtime.mjs";
import { createCompanionStateService } from "./lib/companion-state.mjs";
import { createControlLeaseService } from "./lib/control-lease-service.mjs";
import { createDebugHarnessService } from "./lib/debug-harness-service.mjs";
import {
  openThreadInCodex
} from "./lib/desktop-integration.mjs";
import { createBridgeRuntimeLifecycleService } from "./lib/bridge-runtime-lifecycle.mjs";
import { applyLiveControlAction } from "./lib/live-control-state.mjs";
import { createLivePayloadBuilder } from "./lib/live-payload-builder.mjs";
import { applyLiveSelectionTransition } from "./lib/live-selection-transition-state.mjs";
import { createMockCodexAdapter } from "./lib/mock-codex-adapter.mjs";
import { buildOperatorDiagnostics } from "./lib/operator-diagnostics.mjs";
import { createRepoChangesService } from "./lib/repo-changes-service.mjs";
import { createSelectionStateService } from "./lib/selection-state-service.mjs";
import { createInteractionStateService } from "./lib/interaction-state.mjs";
import { createInteractionResolutionService } from "./lib/interaction-resolution-service.mjs";
import { buildInstallPreflight } from "./lib/install-preflight.mjs";
import { createRuntimeConfig } from "./lib/runtime-config.mjs";
import { createStaticSurfaceService } from "./lib/static-surface-service.mjs";
import { canServeSurfaceBootstrap } from "./lib/surface-request-guard.mjs";
import { createSurfacePresenceService } from "./lib/surface-presence-service.mjs";
import { createThreadSyncStateService } from "./lib/thread-sync-state.mjs";
import { createLiveTranscriptStateService } from "./lib/live-transcript-state.mjs";
import { createWatcherLifecycleService } from "./lib/watcher-lifecycle.mjs";
import {
  createSurfaceAccessRegistry,
  defaultSurfaceAccessSecretPath,
  loadOrCreateSurfaceAccessSecret
} from "./lib/surface-access.mjs";
import {
  applySurfacePresenceUpdate as applySurfacePresenceUpdateState,
  buildSelectedAttachments as buildSelectedAttachmentsState,
  clearControlLease as clearControlLeaseState,
  countSurfacePresence as countSurfacePresenceState,
  ensureRemoteControlLease as ensureRemoteControlLeaseState,
  getControlLeaseForThread as getControlLeaseForThreadState,
  normalizeSurfaceName as normalizeSurfaceNameState,
  pruneStaleSurfacePresence as pruneStaleSurfacePresenceState,
  setControlLease as setControlLeaseState,
  surfaceActorLabel as surfaceActorLabelState,
  renewControlLease as renewControlLeaseState
} from "./lib/shared-room-state.mjs";
import { createSessionStore } from "./lib/session-store.mjs";
import { createSseHub } from "./lib/sse-hub.mjs";

const runtimeConfig = createRuntimeConfig({
  cwd: process.cwd(),
  env: process.env,
  importMetaUrl: import.meta.url
});
const {
  agentRoomDir,
  appServerListenUrl,
  attachmentDir,
  codexBinaryPath,
  devToolsEnabled,
  exposeHostSurface,
  fakeAgentRoomFailures,
  fakeSendDelayMs,
  host,
  mimeTypes,
  port,
  publicDir,
  runtimeProfile,
  useFakeAgentRoom,
  useFakeAppServer
} = runtimeConfig;
const surfaceAccessSecret = await loadOrCreateSurfaceAccessSecret({
  secretPath: defaultSurfaceAccessSecretPath({ cwd: process.cwd() })
});
const surfaceAccess = createSurfaceAccessRegistry({
  secret: surfaceAccessSecret
});
const store = createSessionStore();
const mockAdapter = devToolsEnabled ? createMockCodexAdapter(store) : null;
const agentRoomStore = createAgentRoomStore({
  baseDir: agentRoomDir
});
const agentRoomRuntime = createAgentRoomRuntime({
  artifactsDir: agentRoomDir,
  codexBinaryPath,
  cwd: process.cwd(),
  fake: useFakeAgentRoom,
  fakeFailures: fakeAgentRoomFailures
});
const { appServerState, codexAppServer, liveState } = createCodexRuntime({
  binaryPath: codexBinaryPath,
  cwd: process.cwd(),
  fakeSendDelayMs,
  listenUrl: appServerListenUrl,
  useFakeAppServer
});
const sseHub = createSseHub();
const CONTROL_LEASE_TTL_MS = 5 * 60 * 1000;
const SURFACE_PRESENCE_STALE_MS = 45 * 1000;
const SURFACE_PRESENCE_SWEEP_MS = 15 * 1000;
const COMPANION_WAKEUP_VISIBLE_MS = 6 * 60 * 1000;
const COMPANION_WAKEUP_STALE_MS = 20 * 60 * 1000;
const COMPANION_WAKEUP_SNOOZE_MS = 10 * 60 * 1000;
const COMPANION_WAKEUP_LIMIT = 4;
const ADVISORY_PARTICIPANT_IDS = ["oracle", "gemini"];


if (mockAdapter) {
  mockAdapter.start();
}

const watchRefreshMethods = new Set(APP_SERVER_LIVE_PATCH_NOTIFICATION_METHODS);

const preferredLiveSourceKinds = ["vscode"];
const fallbackLiveSourceKinds = ["vscode", "cli"];
const SESSION_LOG_TAIL_BYTES = 1024 * 1024;
const SELECTED_TRANSCRIPT_PAGE_SIZE = 40;
const THREAD_PREVIEW_TAIL_BYTES = 64 * 1024;
const THREAD_PREVIEW_MAX_CHARS = 96;
const ATTACHMENT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const ATTACHMENT_SWEEP_MS = 30 * 60 * 1000;
const GIT_COMMAND_TIMEOUT_MS = 4000;
const REPO_CHANGES_CACHE_TTL_MS = 2500;
const attachmentService = createAttachmentService({
  attachmentDir,
  maxAgeMs: ATTACHMENT_MAX_AGE_MS
});
const {
  cleanupAttachmentDir,
  persistImageAttachments
} = attachmentService;
const repoChanges = createRepoChangesService({
  cacheTtlMs: REPO_CHANGES_CACHE_TTL_MS,
  gitCommandTimeoutMs: GIT_COMMAND_TIMEOUT_MS,
  sessionLogTailBytes: SESSION_LOG_TAIL_BYTES
});
const repoObjectiveCache = new Map();
function nowIso() {
  return new Date().toISOString();
}
const surfacePresenceService = createSurfacePresenceService({
  appServerState,
  applySurfacePresenceUpdateState,
  buildSelectedAttachmentsState,
  countSurfacePresenceState: countSurfacePresenceState,
  defaultStaleMs: SURFACE_PRESENCE_STALE_MS,
  liveState,
  normalizeSurfaceName: normalizeSurfaceNameState,
  nowIso,
  pruneStaleSurfacePresenceState,
  randomId: () => randomUUID()
});

const {
  applySurfacePresenceUpdate,
  buildSelectedAttachments,
  countSurfacePresence,
  pruneStaleSurfacePresence,
  recordSurfaceEvent,
  removeSurfacePresence,
  upsertSurfacePresence
} = surfacePresenceService;

function trimInteractionText(value, maxLength = 72) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function humanizeServerText(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function requestBaseUrl(req, fallbackHost = "127.0.0.1", fallbackPort = 4317) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").trim();
  const proto = forwardedProto || "http";
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").trim();
  const hostHeader = String(req.headers.host || "").trim();
  const authority = forwardedHost || hostHeader || `${fallbackHost}:${fallbackPort}`;
  return `${proto}://${authority}`;
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function runGit(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: GIT_COMMAND_TIMEOUT_MS
  });
  return stdout;
}

function invalidateRepoChangesCache(params = {}) {
  return repoChanges.invalidateRepoChangesCache(params);
}

async function getCachedRepoChanges(cwd, options = {}) {
  return repoChanges.getCachedRepoChanges(cwd, options);
}

function buildLiveTurnChanges(payload) {
  return repoChanges.buildLiveTurnChanges(payload);
}

function projectLabel(cwd) {
  const parts = String(cwd || "")
    .split("/")
    .filter(Boolean);

  if (parts.length >= 2) {
    return parts.slice(-2).join("/");
  }

  return cwd || "unknown";
}

function projectLeaf(cwd) {
  const parts = String(cwd || "")
    .split("/")
    .filter(Boolean);

  return parts.at(-1) || "";
}

function shortThreadId(value) {
  const id = String(value || "").trim();
  if (!id) {
    return "";
  }

  return id.length > 8 ? id.slice(0, 8) : id;
}

function surfaceActorLabel({ surface = "", clientId = null } = {}) {
  return surfaceActorLabelState({ surface, clientId });
}

function slugifyChannelName(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const trimmed = slug.slice(0, 36).replace(/-+$/g, "");
  return trimmed || "session";
}

function trimTopicText(value, maxLength = 120) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizePreviewText(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeTopicNoise(value) {
  const text = String(value || "").trim();
  if (!text) {
    return true;
  }

  if (/^\[[^\]]+\]\([^)]+\)$/.test(text)) {
    return true;
  }

  return text.startsWith("[$");
}

function isGenericThreadName(name, cwd) {
  const normalized = String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (["session", "untitled", "untitled session", "new session"].includes(normalized)) {
    return true;
  }

  return false;
}

function looksLikeChannelLabelCandidate(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || looksLikeTopicNoise(text)) {
    return false;
  }

  if (text.length > 64) {
    return false;
  }

  if (text.split(/\s+/).length > 9) {
    return false;
  }

  if (/[?]/.test(text)) {
    return false;
  }

  return true;
}

function extractCurrentObjective(markdown) {
  const match = String(markdown || "").match(/## Current Objective\s+([\s\S]*?)(?:\n## |\n# |$)/);
  if (!match) {
    return "";
  }

  return trimTopicText(match[1].replace(/^- /gm, "").trim(), 120);
}

function repoObjective(cwd) {
  const summaryPath = path.join(String(cwd || ""), ".agent", "SUMMARY.md");
  if (!cwd || !existsSync(summaryPath)) {
    return "";
  }

  try {
    const mtimeMs = statSync(summaryPath).mtimeMs;
    const cached = repoObjectiveCache.get(summaryPath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.value;
    }

    const value = extractCurrentObjective(readFileSync(summaryPath, "utf8"));
    repoObjectiveCache.set(summaryPath, { mtimeMs, value });
    return value;
  } catch {
    return "";
  }
}

function bestConversationLabel(snapshot, maxLength = 52) {
  const entry = [...(snapshot?.transcript || [])]
    .reverse()
    .find(
      (candidate) =>
        (candidate?.role === "assistant" || candidate?.role === "user") &&
        candidate?.kind !== "commentary" &&
        looksLikeChannelLabelCandidate(candidate?.text)
    );

  return entry?.text ? trimTopicText(entry.text, maxLength) : "";
}

function selectedThreadSummary() {
  if (!liveState.selectedThreadId) {
    return null;
  }

  return liveState.threads.find((thread) => thread.id === liveState.selectedThreadId) || null;
}

function bestThreadLabel(thread, snapshot, { selected = false } = {}) {
  const genericName = thread?.name ? trimTopicText(thread.name, 52) : "";
  const meaningfulName =
    thread?.name && !isGenericThreadName(thread.name, thread.cwd)
      ? trimTopicText(thread.name, 52)
      : "";
  if (meaningfulName) {
    return meaningfulName;
  }

  if (selected && genericName) {
    return genericName;
  }

  const previewLabel =
    thread?.preview && looksLikeChannelLabelCandidate(thread.preview)
      ? trimTopicText(thread.preview, 52)
      : "";
  if (previewLabel) {
    return previewLabel;
  }

  const conversationLabel = bestConversationLabel(snapshot, 52);
  if (conversationLabel) {
    return conversationLabel;
  }

  if (genericName) {
    return genericName;
  }

  if (selected) {
    return "current session";
  }

  const shortId = shortThreadId(thread?.id);
  return shortId ? `session ${shortId}` : "session";
}

function normalizeLane(source) {
  switch (String(source || "").trim().toLowerCase()) {
    case "remote":
      return "remote";
    case "host":
    case "desktop":
    case "vscode":
      return "desktop";
    case "oracle":
      return "oracle";
    case "gemini":
      return "gemini";
    case "external":
    case "cli":
      return "external";
    default:
      return "";
  }
}

function buildParticipant(id, overrides = {}) {
  const catalog = {
    codex: {
      capability: "write",
      id: "codex",
      label: "codex",
      lane: "",
      role: "live",
      canAct: true,
      sortOrder: 10,
      token: "accent"
    },
    remote: {
      capability: "write",
      id: "remote",
      label: "remote",
      lane: "remote",
      role: "live",
      canAct: true,
      sortOrder: 20,
      token: "remote"
    },
    desktop: {
      capability: "write",
      id: "desktop",
      label: "desktop",
      lane: "desktop",
      role: "live",
      canAct: true,
      sortOrder: 30,
      token: "desktop"
    },
    nix: {
      capability: "advisory",
      id: "nix",
      label: "nix",
      lane: "nix",
      role: "advisory",
      canAct: false,
      sortOrder: 35,
      token: "nix"
    },
    oracle: {
      capability: "advisory",
      id: "oracle",
      label: "oracle",
      lane: "oracle",
      role: "advisory",
      canAct: false,
      sortOrder: 40,
      token: "oracle"
    },
    gemini: {
      capability: "advisory",
      id: "gemini",
      label: "gemini",
      lane: "gemini",
      role: "advisory",
      canAct: false,
      sortOrder: 50,
      token: "gemini"
    },
    claude: {
      capability: "advisory",
      id: "claude",
      label: "claude",
      lane: "claude",
      role: "advisory",
      canAct: false,
      sortOrder: 55,
      token: "claude"
    },
    spark: {
      capability: "advisory",
      id: "spark",
      label: "spark",
      lane: "spark",
      role: "advisory",
      canAct: false,
      sortOrder: 57,
      token: "spark"
    },
    tools: {
      capability: "observe",
      id: "tools",
      label: "tools",
      lane: "",
      role: "tool",
      canAct: false,
      sortOrder: 60,
      token: "tool"
    },
    updates: {
      capability: "observe",
      id: "updates",
      label: "updates",
      lane: "",
      role: "system",
      canAct: false,
      sortOrder: 70,
      token: "updates"
    },
    system: {
      capability: "observe",
      id: "system",
      label: "system",
      lane: "",
      role: "system",
      canAct: false,
      sortOrder: 80,
      token: "system"
    },
    user: {
      capability: "write",
      id: "user",
      label: "user",
      lane: "",
      role: "live",
      canAct: true,
      sortOrder: 90,
      token: "user"
    }
  };

  return {
    ...(catalog[id] || catalog.user),
    ...overrides
  };
}

const companionState = createCompanionStateService({
  ADVISORY_PARTICIPANT_IDS,
  COMPANION_WAKEUP_LIMIT,
  COMPANION_WAKEUP_SNOOZE_MS,
  COMPANION_WAKEUP_STALE_MS,
  COMPANION_WAKEUP_VISIBLE_MS,
  buildParticipant,
  liveState,
  nowIso
});

const {
  applyCompanionWakeupAction,
  buildSelectedCompanionState,
  defaultAdvisoryState,
  pruneAllCompanionWakeups,
  queueCompanionWakeup,
  resetCompanionWakeups,
  summonCompanionWakeup
} = companionState;

function advisoryParticipantForThread(advisorId, threadId) {
  const selected = buildSelectedCompanionState(threadId);
  const advisory = selected.advisories.find((entry) => entry.id === advisorId) || defaultAdvisoryState(advisorId);
  return buildParticipant(advisorId, {
    lastWakeAt: advisory.lastWakeAt || null,
    metaLabel: advisory.metaLabel || "dormant",
    state: advisory.state || "dormant",
    wakeKind: advisory.wakeKind || null
  });
}

const interactionState = createInteractionStateService({
  appServerState,
  liveState,
  nowIso,
  trimInteractionText
});

const {
  beginInteractionFlow,
  clearInteractionFlow,
  getLastControlEventForSelectedThread,
  getLastInteractionForSelectedThread,
  getLastSelectionEventForSelectedThread,
  getLastSurfaceEventForSelectedThread,
  getLastWriteForSelectedThread,
  getPendingInteractionForSelectedThread,
  interactionKindLabel,
  interactionRequestSummary,
  mapPendingInteraction,
  summarizeNotificationInteraction
} = interactionState;

const buildBridgeStatus = createBridgeStatusBuilder({
  appServerState,
  buildOperatorDiagnostics,
  buildSelectedAttachments,
  codexAppServer,
  devToolsEnabled,
  getControlLeaseForSelectedThread: (...args) => getControlLeaseForSelectedThread(...args),
  getLastControlEventForSelectedThread,
  getLastInteractionForSelectedThread,
  getLastSelectionEventForSelectedThread,
  getLastSurfaceEventForSelectedThread,
  getLastWriteForSelectedThread,
  liveState,
  runtimeProfile
});

let buildAgentRoomContextMarkdown = () => "";
let buildLivePayload = () => ({});
const agentRoomService = createAgentRoomService({
  buildParticipant,
  broadcast,
  codexAppServer,
  defaultAgentRoomState,
  getBuildAgentRoomContextMarkdown: () => buildAgentRoomContextMarkdown,
  getLivePayload: () => buildLivePayload(),
  getAgentRoomRetryRound,
  interruptAgentRoomRound,
  liveState,
  mapThreadToCompanionSnapshot,
  normalizeAgentRoomState,
  nowIso,
  persistState: async (target, value, options = {}) => {
    if (options.raw) {
      await writeFile(target, value, "utf8");
      return;
    }
    await agentRoomStore.save(target, value);
  },
  randomId: () => randomUUID(),
  runtime: agentRoomRuntime,
  setAgentRoomEnabled,
  settleAgentRoomParticipant,
  startAgentRoomRound,
  store: agentRoomStore
});

const {
  buildSelectedAgentRoomState,
  loadThreadAgentRoomState,
  updateAgentRoom
} = agentRoomService;

const livePayloadBuilder = createLivePayloadBuilder({
  advisoryParticipantForThread,
  ADVISORY_PARTICIPANT_IDS,
  bestConversationLabel,
  bestThreadLabel,
  buildBridgeStatus,
  buildParticipant,
  buildSelectedAgentRoomState,
  buildSelectedAttachments,
  buildSelectedCompanionState,
  getPendingInteractionForSelectedThread,
  liveState,
  looksLikeTopicNoise,
  normalizeLane,
  projectLabel,
  pruneAllCompanionWakeups,
  pruneStaleSurfacePresence,
  repoObjective,
  selectedThreadSummary,
  slugifyChannelName,
  summarizeThread,
  trimTopicText
});

const {
  applyTurnOrigins,
  buildChannelTopic,
  buildParticipants,
  buildSelectedChannel,
  decorateSnapshot,
  inferEntryLane,
  participantForEntry
} = livePayloadBuilder;
buildLivePayload = livePayloadBuilder.buildLivePayload;

const liveTranscriptState = createLiveTranscriptStateService({
  extractNotificationDelta: (params = {}) => (
    params.delta ??
    params.textDelta ??
    params.outputDelta ??
    params.output ??
    params.chunk ??
    ""
  ),
  getDefaultCwd: () => liveState.selectedProjectCwd || process.cwd(),
  liveState,
  mapThreadItemToCompanionEntry,
  nowIso,
  visibleTranscriptLimit: SELECTED_TRANSCRIPT_PAGE_SIZE
});

const { applyWatcherNotification } = liveTranscriptState;

({ buildAgentRoomContextMarkdown } = createAgentRoomContextBuilder({
  buildSelectedChannel,
  decorateSnapshot,
  nowIso,
  trimTopicText
}));

function recordControlEvent({
  action,
  actor = "system",
  actorClientId = null,
  cause = "manual",
  owner = null,
  ownerClientId = null,
  ownerLabel = null,
  reason = null,
  source = null,
  threadId = null
} = {}) {
  if (!action || !threadId) {
    return null;
  }

  appServerState.lastControlEvent = {
    action,
    actor,
    actorClientId: actorClientId ? String(actorClientId).trim() : null,
    actorLabel: surfaceActorLabel({ surface: actor, clientId: actorClientId }),
    at: nowIso(),
    cause,
    id: randomUUID(),
    owner,
    ownerClientId: ownerClientId ? String(ownerClientId).trim() : null,
    ownerLabel: ownerLabel || surfaceActorLabel({ surface: owner || source, clientId: ownerClientId }),
    reason,
    source,
    threadId
  };
  return appServerState.lastControlEvent;
}

function maybeWakeCompanionForTurnCompletion({ threadId, turnId = null } = {}) {
  const diff = liveState.turnDiff?.threadId === threadId ? String(liveState.turnDiff.diff || "").trim() : "";
  if (!threadId || !diff) {
    return false;
  }

  return queueCompanionWakeup({
    advisorId: "oracle",
    text: "Review ready: the latest turn settled with live file changes. Oracle can do a quick risk pass if you want a second opinion.",
    threadId,
    turnId,
    wakeKey: `oracle-review:${turnId || threadId}`,
    wakeKind: "review"
  });
}

function maybeWakeCompanionForCompaction({ threadId, turnId = null } = {}) {
  if (!threadId) {
    return false;
  }

  return queueCompanionWakeup({
    advisorId: "gemini",
    text: "Summary ready: context compacted on this channel. Gemini can give you a quick continuity brief if you want one.",
    threadId,
    turnId,
    wakeKey: `gemini-summary:${turnId || threadId}`,
    wakeKind: "summary"
  });
}

function maybeWakeCompanionForInteractionResolution({ interaction = null, threadId = null } = {}) {
  const nextThreadId = threadId || interaction?.threadId || null;
  if (!nextThreadId) {
    return false;
  }

  const kindLabel = interaction?.kindLabel
    ? humanizeServerText(interaction.kindLabel)
    : humanizeServerText(interaction?.kind || "interaction");
  const wakeKeySuffix =
    interaction?.requestId ||
    interaction?.at ||
    interaction?.turnId ||
    nextThreadId;
  return queueCompanionWakeup({
    advisorId: "gemini",
    text: `Summary ready: the last ${kindLabel} step settled. Gemini can give you a quick recap if you want one.`,
    threadId: nextThreadId,
    turnId: interaction?.turnId || null,
    wakeKey: `gemini-interaction:${interaction?.kind || "interaction"}:${wakeKeySuffix}`,
    wakeKind: "summary"
  });
}

const controlLeaseService = createControlLeaseService({
  broadcast,
  buildLivePayload,
  clearControlLeaseState,
  defaultTtlMs: CONTROL_LEASE_TTL_MS,
  ensureRemoteControlLeaseState,
  getControlLeaseForThreadState,
  liveState,
  recordControlEvent,
  renewControlLeaseState,
  setControlLeaseState
});

const {
  clearControlLease,
  ensureRemoteControlLease,
  getControlLeaseForSelectedThread,
  getControlLeaseForThread,
  renewControlLease,
  scheduleControlLeaseExpiry,
  setControlLease
} = controlLeaseService;
const staticSurfaceService = createStaticSurfaceService({
  exposeHostSurface,
  issueSurfaceBootstrap: (surface) => surfaceAccess.issueBootstrap(surface),
  mimeTypes,
  publicDir,
  sendJson
});
const { serveStatic } = staticSurfaceService;

function broadcast(event, payload) {
  sseHub.broadcast(event, payload);
}

function requireSurfaceCapability(req, url, capability) {
  return surfaceAccess.requireCapability({
    capability,
    headers: req.headers,
    searchParams: url.searchParams
  });
}

function resolveSurfaceAccess(req, url) {
  return surfaceAccess.resolve({
    headers: req.headers,
    searchParams: url.searchParams
  });
}

function accessClientId(access) {
  return String(access?.clientId || "").trim() || null;
}

function errorStatusCode(error, fallback = 500) {
  const code = Number(error?.statusCode || error?.status || fallback);
  return Number.isFinite(code) && code > 0 ? code : fallback;
}

function summarizeThread(thread) {
  const channelLabel = bestThreadLabel(thread, null);
  const openingPreview = deriveOpeningPreview(thread);
  const latestPreview = deriveLatestPreview(thread);

  return {
    channelLabel,
    channelSlug: `#${slugifyChannelName(channelLabel)}`,
    cwd: thread.cwd || null,
    id: thread.id,
    name: thread.name || null,
    openingPreview,
    preview: latestPreview || trimTopicText(normalizePreviewText(thread.preview), THREAD_PREVIEW_MAX_CHARS) || null,
    serverLabel: projectLabel(thread.cwd || ""),
    source: thread.source || null,
    status: thread.status || null,
    updatedAt: thread.updatedAt || null
  };
}

function deriveOpeningPreview(thread) {
  if (!thread || !Array.isArray(thread.turns) || thread.turns.length === 0) {
    return null;
  }

  const snapshot = mapThreadToCompanionSnapshot(thread, { limit: null });
  const opener = snapshot?.transcript?.find((entry) => String(entry?.text || "").trim().length > 0) || null;
  const text = normalizePreviewText(opener?.text || "");
  if (!text) {
    return null;
  }
  return trimTopicText(text, THREAD_PREVIEW_MAX_CHARS);
}

function deriveLatestPreview(thread) {
  let transcript = [];

  if (thread && Array.isArray(thread.turns) && thread.turns.length > 0) {
    transcript = mapThreadToCompanionSnapshot(thread, { limit: null }).transcript || [];
  } else if (thread?.path) {
    transcript = readTranscriptFromSessionLog(thread.path, {
      limit: 24,
      maxBytes: THREAD_PREVIEW_TAIL_BYTES
    });
  }

  if (!transcript.length) {
    return null;
  }

  const latest =
    [...transcript]
      .reverse()
      .find((entry) => (
        (entry?.role === "assistant" || entry?.role === "user") &&
        entry?.kind !== "commentary" &&
        normalizePreviewText(entry?.text || "") &&
        !looksLikeTopicNoise(normalizePreviewText(entry?.text || ""))
      )) || null;
  const text = normalizePreviewText(latest?.text || "");
  if (!text) {
    return null;
  }
  return trimTopicText(text, THREAD_PREVIEW_MAX_CHARS);
}

function rememberTurnOrigin(threadId, turnId, source) {
  if (!threadId || !turnId || !source) {
    return;
  }

  const current = liveState.turnOriginsByThreadId[threadId] || {};
  const next = {
    ...current,
    [turnId]: source
  };
  const keys = Object.keys(next);

  if (keys.length > 80) {
    const trimmed = {};
    for (const key of keys.slice(-80)) {
      trimmed[key] = next[key];
    }
    liveState.turnOriginsByThreadId[threadId] = trimmed;
    return;
  }

  liveState.turnOriginsByThreadId[threadId] = next;
}

async function buildSelectedThreadSnapshotFromLog(thread, { limit = SELECTED_TRANSCRIPT_PAGE_SIZE } = {}) {
  const transcriptLimit = Math.max(1, Number.parseInt(limit, 10) || SELECTED_TRANSCRIPT_PAGE_SIZE);
  const snapshot = buildLightweightSelectedThreadSnapshotFromLog(thread, {
    limit: transcriptLimit
  });

  if (Array.isArray(thread?.turns) && thread.turns.length > 0) {
    const fullSnapshot = mapThreadToCompanionSnapshot(thread, { limit: transcriptLimit });
    if (fullSnapshot.transcriptCount > snapshot.transcriptCount) {
      return fullSnapshot;
    }
  }

  if (snapshot.transcriptCount >= transcriptLimit) {
    return snapshot;
  }

  const fullThread = await codexAppServer.readThread(thread.id, true);
  if (!fullThread) {
    return snapshot;
  }

  const fullSnapshot = mapThreadToCompanionSnapshot(fullThread, { limit: transcriptLimit });
  return fullSnapshot.transcriptCount > snapshot.transcriptCount ? fullSnapshot : snapshot;
}

function buildLightweightSelectedThreadSnapshotFromLog(thread, { limit = SELECTED_TRANSCRIPT_PAGE_SIZE } = {}) {
  const transcriptLimit = Math.max(1, Number.parseInt(limit, 10) || SELECTED_TRANSCRIPT_PAGE_SIZE);
  if (Array.isArray(thread?.turns) && thread.turns.length > 0) {
    return mapThreadToCompanionSnapshot(thread, { limit: transcriptLimit });
  }

  return buildSessionLogSnapshot(thread, {
    limit: transcriptLimit,
    maxBytes: SESSION_LOG_TAIL_BYTES
  });
}

function selectedThreadSnapshotNeedsDeepHydration(snapshot, {
  limit = SELECTED_TRANSCRIPT_PAGE_SIZE,
  thread = null
} = {}) {
  const transcriptLimit = Math.max(1, Number.parseInt(limit, 10) || SELECTED_TRANSCRIPT_PAGE_SIZE);
  if (Array.isArray(thread?.turns) && thread.turns.length > 0) {
    return false;
  }

  return Number(snapshot?.transcriptCount || 0) < transcriptLimit;
}

function buildTranscriptHistoryPageFromThread(thread, {
  beforeIndex = null,
  limit = 40,
  visibleCount = null
} = {}) {
  const transcript = mapThreadToCompanionSnapshot(thread, { limit: null }).transcript || [];
  return pageTranscriptEntries(transcript, {
    beforeIndex,
    limit,
    visibleCount
  });
}

async function loadTranscriptHistoryPage({
  beforeIndex = null,
  limit = 40,
  threadId,
  visibleCount = null
} = {}) {
  if (!threadId) {
    throw new Error("threadId is required");
  }

  const thread =
    (liveState.selectedThreadSnapshot?.thread?.id === threadId
      ? liveState.selectedThreadSnapshot.thread
      : liveState.threads.find((entry) => entry.id === threadId)) ||
    await codexAppServer.readThread(threadId, false);

  if (!thread) {
    throw Object.assign(new Error(`Thread ${threadId} not found.`), { statusCode: 404 });
  }

  const logPage = readTranscriptHistoryPageFromSessionLog(thread.path, {
    beforeIndex,
    limit,
    visibleCount
  });

  if (Array.isArray(thread.turns) && thread.turns.length > 0) {
    const fullPage = buildTranscriptHistoryPageFromThread(thread, {
      beforeIndex,
      limit,
      visibleCount
    });
    if (fullPage.totalCount > logPage.totalCount) {
      return fullPage;
    }
  }

  const fullThread = await codexAppServer.readThread(threadId, true);
  if (!fullThread) {
    return logPage;
  }

  const fullPage = buildTranscriptHistoryPageFromThread(fullThread, {
    beforeIndex,
    limit,
    visibleCount
  });
  return fullPage.totalCount > logPage.totalCount ? fullPage : logPage;
}

const threadSyncState = createThreadSyncStateService({
  broadcast,
  buildLivePayload,
  buildLightweightSelectedThreadSnapshot: buildLightweightSelectedThreadSnapshotFromLog,
  buildSelectedThreadSnapshot: buildSelectedThreadSnapshotFromLog,
  clearControlLease,
  codexAppServer,
  fallbackLiveSourceKinds,
  liveState,
  loadThreadAgentRoomState,
  mapThreadToCompanionSnapshot,
  nowIso,
  preferredLiveSourceKinds,
  processCwd: () => process.cwd(),
  snapshotNeedsDeepHydration: selectedThreadSnapshotNeedsDeepHydration,
  selectedTranscriptLimit: SELECTED_TRANSCRIPT_PAGE_SIZE,
  readSelectedThread: (threadId) => codexAppServer.readThread(threadId, false),
  summarizeThread
});

const {
  createThreadSelectionState,
  mergeSelectedThreadSnapshot,
  prewarmThreadSnapshots,
  refreshLiveState,
  refreshSelectedThreadSnapshot,
  refreshThreads
} = threadSyncState;
const watcherLifecycle = createWatcherLifecycleService({
  appServerState,
  applyWatcherNotification,
  beginInteractionFlow,
  broadcast,
  buildLivePayload,
  clearInteractionFlow,
  codexAppServer,
  invalidateRepoChangesCache,
  liveState,
  mapPendingInteraction,
  maybeWakeCompanionForCompaction,
  maybeWakeCompanionForInteractionResolution,
  maybeWakeCompanionForTurnCompletion,
  nowIso,
  refreshSelectedThreadSnapshot,
  rememberTurnOrigin,
  resetCompanionWakeups,
  summarizeNotificationInteraction,
  watchRefreshMethods
});

const {
  clearWatcher,
  getWatcherController,
  hasWatcherController,
  restartWatcher,
  scheduleSnapshotRefresh
} = watcherLifecycle;
const selectionStateService = createSelectionStateService({
  appServerState,
  applyLiveSelectionTransition,
  bestThreadLabel,
  broadcast,
  buildLivePayload,
  createThreadSelectionState,
  getPendingInteractionForSelectedThread,
  liveState,
  nowIso,
  nowMs: () => Date.now(),
  projectLabel,
  randomId: () => randomUUID(),
  refreshSelectedThreadSnapshot,
  refreshThreads,
  restartWatcher,
  scheduleControlLeaseExpiry,
  shortThreadId,
  slugifyChannelName,
  surfaceActorLabel
});

const {
  createThreadSelection,
  setSelection
} = selectionStateService;
const debugHarnessService = createDebugHarnessService({
  ADVISORY_PARTICIPANT_IDS,
  appServerState,
  broadcast,
  buildLivePayload,
  getDefaultCwd: () => process.cwd(),
  liveState,
  nowIso,
  nowMs: () => Date.now(),
  queueCompanionWakeup
});

const {
  clearDebugPendingInteraction,
  setDebugCompanionWakeup,
  setDebugPendingInteraction
} = debugHarnessService;

const interactionResolutionService = createInteractionResolutionService({
  appServerState,
  broadcast,
  buildLivePayload,
  controlLeaseTtlMs: CONTROL_LEASE_TTL_MS,
  ensureRemoteControlLease,
  getWatcherController,
  hasWatcherController,
  liveState,
  maybeWakeCompanionForInteractionResolution,
  nowIso,
  setControlLease
});

const {
  resolvePendingInteraction
} = interactionResolutionService;

const bridgeRuntimeLifecycle = createBridgeRuntimeLifecycleService({
  broadcast,
  buildLivePayload,
  cleanupAttachmentDir,
  codexAppServer,
  liveState,
  prewarmThreadSnapshots,
  refreshSelectedThreadSnapshot,
  refreshThreads,
  restartWatcher,
  scheduleSnapshotRefresh
});

const {
  bootstrapLiveState,
  interruptSelectedThread
} = bridgeRuntimeLifecycle;

function streamState(req, res) {
  sseHub.open(res, [
    { event: "snapshot", payload: store.getState() },
    { event: "live", payload: buildLivePayload() }
  ], {
    "Cache-Control": "no-cache, no-transform",
    "Content-Type": "text/event-stream; charset=utf-8"
  });

  req.on("close", () => {
    sseHub.close(res);
    res.end();
  });
}

store.subscribe((snapshot) => {
  broadcast("snapshot", snapshot);
});

setInterval(() => {
  const surfacesChanged = pruneStaleSurfacePresence();
  const companionChanged = pruneAllCompanionWakeups();
  if (surfacesChanged || companionChanged) {
    broadcast("live", buildLivePayload());
  }
}, SURFACE_PRESENCE_SWEEP_MS);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const handled = await handleBridgeApiRequest({
      req,
      res,
      url,
      deps: {
        CONTROL_LEASE_TTL_MS,
        accessClientId,
        appServerState,
        applyCompanionWakeupAction,
        applyLiveControlAction,
        applySurfacePresenceUpdate,
        broadcast,
        buildBridgeStatus,
        buildInstallPreflight,
        buildLivePayload,
        buildLiveTurnChanges,
        buildSelectedThreadSnapshot: buildSelectedThreadSnapshotFromLog,
        canServeSurfaceBootstrap,
        clearDebugPendingInteraction,
        codexAppServer,
        createThreadSelection,
        decorateSnapshot,
        devToolsEnabled,
        exposeHostSurface,
        ensureRemoteControlLease,
        errorStatusCode,
        getCachedRepoChanges,
        getControlLeaseForThread,
        interruptSelectedThread,
        invalidateRepoChangesCache,
        issueSurfaceBootstrap: (surface) => surfaceAccess.issueBootstrap(surface),
        liveState,
        loadTranscriptHistoryPage,
        cwd: process.cwd(),
        mapThreadToCompanionSnapshot,
        mergeSelectedThreadSnapshot,
        mockAdapter,
        nowIso,
        openThreadInCodex,
        persistImageAttachments,
        readJsonBody,
        recordControlEvent,
        refreshLiveState,
        refreshThreads,
        rememberTurnOrigin,
        requireSurfaceCapability,
        resolvePendingInteraction,
        resolveSurfaceAccess,
        restartWatcher,
        hasWatcherController,
        scheduleSnapshotRefresh,
        scheduleControlLeaseExpiry,
        sendJson,
        setDebugCompanionWakeup,
        setDebugPendingInteraction,
        setSelection,
        store,
        streamState,
        summonCompanionWakeup,
        updateAgentRoom,
        runtimeConfig
      }
    });
    if (handled) {
      return;
    }

    if (req.method === "GET") {
      const baseUrl = requestBaseUrl(req, host === "0.0.0.0" ? "127.0.0.1" : host, port);

      if (url.pathname === DISCOVERY_MANIFEST_PATH) {
        sendJson(res, 200, buildWellKnownManifest({ baseUrl }));
        return;
      }

      if (url.pathname === OPENAPI_DOC_PATH) {
        sendJson(res, 200, buildOpenApiDocument({ baseUrl }));
        return;
      }

      if (url.pathname === ARAZZO_DOC_PATH) {
        res.writeHead(200, {
          "Cache-Control": "no-store, max-age=0",
          "Content-Type": "application/vnd.oai.workflows+json; charset=utf-8",
          Pragma: "no-cache"
        });
        res.end(JSON.stringify(buildArazzoDocument({ baseUrl })));
        return;
      }

      if (url.pathname === LLMS_TXT_PATH) {
        res.writeHead(200, {
          "Cache-Control": "no-store, max-age=0",
          "Content-Type": "text/plain; charset=utf-8",
          Pragma: "no-cache"
        });
        res.end(buildLlmsText({ baseUrl }));
        return;
      }

      await serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, errorStatusCode(error, 500), { error: error.message, state: buildLivePayload() });
  }
});

const attachmentSweepTimer = setInterval(() => {
  void cleanupAttachmentDir();
}, ATTACHMENT_SWEEP_MS);
attachmentSweepTimer.unref?.();

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const printableHost =
    host === "0.0.0.0"
      ? "0.0.0.0 (all interfaces; 127.0.0.1 also works)"
      : host;
  const localOpenHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const baseUrl = `http://${localOpenHost}:${actualPort}`;
  console.log(`Dextunnel MVP listening on http://${printableHost}:${actualPort}`);
  console.log(`Remote: ${baseUrl}/`);
  console.log(`Legacy remote path: ${baseUrl}/remote.html`);
  console.log("Preflight: npm run doctor");
  if (host === "127.0.0.1") {
    console.log("Phone or tablet access: npm run start:network");
  }
  void bootstrapLiveState();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    clearWatcher();
    mockAdapter?.stop();
    await codexAppServer.dispose();
    process.exit(0);
  });
}
