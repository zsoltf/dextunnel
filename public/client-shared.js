export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function stableSurfaceClientId(surface = "surface") {
  const normalizedSurface = String(surface || "surface").trim().toLowerCase() || "surface";
  const storageKey = `dextunnel:surface-client:${normalizedSurface}`;
  const fallback = `${normalizedSurface}-${Math.random().toString(16).slice(2)}-${Date.now().toString(36)}`;

  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) {
      return existing;
    }

    const nextId = window.crypto?.randomUUID?.() || fallback;
    window.sessionStorage.setItem(storageKey, nextId);
    return nextId;
  } catch {
    return window.crypto?.randomUUID?.() || fallback;
  }
}

function bootstrapStorageKey(surface = "remote") {
  return `dextunnel:surface-bootstrap:${String(surface || "remote").trim().toLowerCase() || "remote"}`;
}

function bootstrapExpired(bootstrap) {
  const expiresAt = String(bootstrap?.expiresAt || "").trim();
  if (!expiresAt) {
    return true;
  }

  const expiresAtMs = new Date(expiresAt).getTime();
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

function usableBootstrap(bootstrap, expectedSurface) {
  const normalizedSurface =
    String(bootstrap?.surface || "")
      .trim()
      .toLowerCase() || null;
  if (!bootstrap?.accessToken || !bootstrap?.clientId) {
    return false;
  }
  if (normalizedSurface !== expectedSurface) {
    return false;
  }
  return !bootstrapExpired(bootstrap);
}

export function getSurfaceBootstrap(expectedSurface = "remote") {
  const expected = String(expectedSurface || "remote").trim().toLowerCase() || "remote";
  const injectedBootstrap = window.__DEXTUNNEL_SURFACE_BOOTSTRAP__ || null;
  let storedBootstrap = null;

  try {
    const raw = window.sessionStorage.getItem(bootstrapStorageKey(expected));
    storedBootstrap = raw ? JSON.parse(raw) : null;
  } catch {
    storedBootstrap = null;
  }

  const injectedUsable = usableBootstrap(injectedBootstrap, expected);
  const storedUsable = usableBootstrap(storedBootstrap, expected);
  const bootstrap = injectedUsable ? injectedBootstrap : storedUsable ? storedBootstrap : injectedBootstrap;

  if (!bootstrap?.accessToken || !bootstrap?.surface || !bootstrap?.clientId) {
    throw new Error("Dextunnel surface bootstrap missing. Reload the page.");
  }
  if (String(bootstrap.surface).trim().toLowerCase() !== expected) {
    throw new Error(`Expected ${expected} surface bootstrap, got ${bootstrap.surface}.`);
  }

  if (injectedUsable || storedUsable) {
    try {
      window.sessionStorage.setItem(bootstrapStorageKey(expected), JSON.stringify(bootstrap));
    } catch {}
  }

  return bootstrap;
}

export function withSurfaceHeaders(options = {}, accessToken = "") {
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      "x-dextunnel-surface-token": accessToken
    }
  };
}

export function withSurfaceTokenUrl(url, accessToken = "") {
  const nextUrl = new URL(url, window.location.origin);
  nextUrl.searchParams.set("surfaceToken", accessToken);
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}

export function formatTimestamp(value) {
  if (value == null || value === "") {
    return "";
  }

  const normalized = typeof value === "number" && value < 1e12 ? value * 1000 : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatSessionTimestamp(value) {
  if (value == null || value === "") {
    return "";
  }

  const normalized = typeof value === "number" && value < 1e12 ? value * 1000 : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatRecoveryDuration(valueMs) {
  const durationMs = Number(valueMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0.0s";
  }

  const seconds = durationMs / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }

  return `${Math.round(seconds)}s`;
}

export function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function createRequestError(payload = {}, response = {}) {
  const rawMessage = payload?.error || `${response?.url || "request"} failed with ${response?.status || 0}`;
  const message = /surface access is missing or expired/i.test(rawMessage)
    ? "Session access expired. Reload Dextunnel."
    : rawMessage;
  const error = new Error(message);
  error.name = "RequestError";
  error.payload = payload || null;
  error.state = payload?.state || null;
  error.status = Number(response?.status || 0);
  return error;
}

export function currentSurfaceTranscript({ liveState = null, bootstrapSnapshot = null } = {}) {
  const selectedThreadId = String(liveState?.selectedThreadId || "").trim();
  const selectedSnapshotThreadId = String(liveState?.selectedThreadSnapshot?.thread?.id || "").trim();
  const selectedTranscript = Array.isArray(liveState?.selectedThreadSnapshot?.transcript)
    ? liveState.selectedThreadSnapshot.transcript
    : [];

  if (selectedThreadId) {
    return selectedSnapshotThreadId === selectedThreadId ? selectedTranscript : [];
  }

  if (selectedSnapshotThreadId) {
    return selectedTranscript;
  }

  return Array.isArray(bootstrapSnapshot?.transcript) ? bootstrapSnapshot.transcript : [];
}

export function formatBusyMarqueeText(value = "", fallback = "Loading") {
  const normalized = String(value || "")
    .replace(/[.…]+\s*$/u, "")
    .trim();
  return normalized || fallback;
}

export function describeThreadState({ pendingInteraction = null, status = null, thread = null } = {}) {
  if (pendingInteraction) {
    return "action required";
  }

  if (status?.writeLock?.status) {
    return `write ${humanize(status.writeLock.status)}`;
  }

  if (thread?.activeTurnId) {
    return "turn running";
  }

  if (status?.lastWriteForSelection?.error) {
    return "last write failed";
  }

  return "ready";
}

export function describeDesktopSyncNote({
  hasSelectedThread = false,
  status = null
} = {}) {
  if (!hasSelectedThread) {
    return "Select a thread to reveal in Codex.";
  }

  const lastWrite = status?.lastWriteForSelection || status?.lastWrite || null;
  if (lastWrite?.source === "remote" || lastWrite?.source === "external") {
    return "Saved here. Reveal in Codex opens the thread there. Quit and reopen the Codex app manually to see new messages.";
  }

  return "Reveal in Codex opens this thread in the app. Quit and reopen the Codex app manually to see newer messages from Dextunnel.";
}

export function describeRemoteScopeNote({
  hasSelectedThread = false,
  channelLabel = ""
} = {}) {
  if (!hasSelectedThread) {
    return "Pick a thread first.";
  }

  const target = String(channelLabel || "").trim() || "the selected thread";
  return `Shared thread. Sends to ${target}.`;
}

export function describeRemoteDesktopSyncNote({
  hasSelectedThread = false,
  status = null
} = {}) {
  if (!hasSelectedThread) {
    return "Desktop Codex can lag behind remote writes. Reveal in Codex navigates only.";
  }

  const lastWrite = status?.lastWriteForSelection || status?.lastWrite || null;
  if (lastWrite?.source === "remote" || lastWrite?.source === "external") {
    return "Sent here. Dextunnel is current. Desktop Codex may still need a quit and reopen to show this turn.";
  }

  return "Desktop Codex can lag behind remote writes. Reveal in Codex navigates only; quit and reopen Codex if you need desktop to catch up.";
}

function diagnosticSortWeight(item) {
  if (item?.severity === "warn") {
    return 0;
  }

  return 1;
}

function diagnosticLeaseOwnerLabel(lease = null) {
  const raw = String(lease?.ownerLabel || lease?.owner || lease?.source || "").trim();
  if (!raw) {
    return "another surface";
  }

  return humanize(raw);
}

export function describeOperatorDiagnostics({
  diagnostics = [],
  ownsControl = false,
  status = null,
  surface = "remote"
} = {}) {
  const items = [];
  const lease = status?.controlLeaseForSelection || null;
  const normalizedSurface = String(surface || "remote").trim().toLowerCase() || "remote";

  for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
    const code = String(diagnostic?.code || "").trim();
    if (!code) {
      continue;
    }

    if (code === "desktop_restart_required") {
      continue;
    }

    if (code === "host_unavailable" && normalizedSurface === "host") {
      continue;
    }

    if (code === "control_held") {
      if (!lease || ownsControl) {
        continue;
      }

      items.push({
        code,
        severity: diagnostic?.severity || "info",
        title: diagnostic?.summary || "Control is currently held elsewhere.",
        label: `control held by ${diagnosticLeaseOwnerLabel(lease)}`
      });
      continue;
    }

    if (code === "bridge_last_error") {
      const bridgeOffline = (diagnostics || []).some((entry) => entry?.code === "bridge_unavailable");
      if (bridgeOffline) {
        continue;
      }
    }

    let label = "";
    switch (code) {
      case "bridge_unavailable":
        label = "bridge offline";
        break;
      case "no_selected_room":
        label = "select a room";
        break;
      case "host_unavailable":
        label = "host offline";
        break;
      case "bridge_last_error":
        label = "bridge error";
        break;
      default:
        label = humanize(diagnostic?.summary || code);
        break;
    }

    items.push({
      code,
      severity: diagnostic?.severity || "info",
      title: diagnostic?.summary || label,
      detail: diagnostic?.detail || "",
      label
    });
  }

  return items.sort((left, right) => diagnosticSortWeight(left) - diagnosticSortWeight(right));
}

export function formatSurfaceAttachmentSummary(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return "";
  }

  return attachments
    .map((attachment) => {
      const label = String(attachment?.label || attachment?.surface || "surface").trim();
      const state = String(attachment?.state || "open").trim();
      const count = Number.isFinite(attachment?.count) && attachment.count > 1 ? ` x${attachment.count}` : "";
      return `${label} ${state}${count}`;
    })
    .join(" // ");
}

export function mergeSurfaceAttachments(attachments = [], localAttachment = null) {
  const items = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (!localAttachment?.surface) {
    return items;
  }

  if (items.some((attachment) => attachment?.surface === localAttachment.surface)) {
    return items;
  }

  return [localAttachment, ...items];
}

export function projectLabel(cwd) {
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

function looksLikeTopicNoise(value) {
  const text = String(value || "").trim();
  if (!text) {
    return true;
  }

  if (/^\[[^\]]+\]\([^)]+\)$/.test(text)) {
    return true;
  }

  if (/^\$[A-Za-z0-9._-]+$/.test(text)) {
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

export function threadDisplayTitle(thread) {
  const channelLabel = String(thread?.channelLabel || "").replace(/\s+/g, " ").trim();
  if (channelLabel) {
    return channelLabel;
  }

  const name = String(thread?.name || "").replace(/\s+/g, " ").trim();
  if (name && !isGenericThreadName(name, thread?.cwd)) {
    return name;
  }

  const preview = String(thread?.preview || "").replace(/\s+/g, " ").trim();
  if (preview && !looksLikeTopicNoise(preview) && preview.length <= 64 && preview.split(/\s+/).length <= 9) {
    return preview;
  }

  if (name) {
    return name;
  }

  return "Current session";
}

export function sessionLabel(thread) {
  const rawTitle = threadDisplayTitle(thread);
  const title = rawTitle.length > 46 ? `${rawTitle.slice(0, 43)}...` : rawTitle;
  const stamp = formatSessionTimestamp(thread.updatedAt);
  return stamp ? `${title} - ${stamp}` : title;
}

export function shortThreadId(value) {
  const id = String(value || "").trim();
  if (!id) {
    return "";
  }

  return id.length > 13 ? id.slice(0, 13) : id;
}

export function groupThreadsByProject(threads) {
  const groups = new Map();

  for (const thread of threads || []) {
    const cwd = thread.cwd || "";
    const existing = groups.get(cwd) || {
      cwd,
      label: projectLabel(cwd),
      threads: []
    };
    existing.threads.push(thread);
    groups.set(cwd, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      threads: group.threads.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    }))
    .sort((a, b) => (b.threads[0]?.updatedAt || 0) - (a.threads[0]?.updatedAt || 0));
}

function threadStatusValue(value) {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value && typeof value === "object") {
    return String(value.type || value.status || "").trim().toLowerCase();
  }

  return "";
}

function threadTimestampValue(value) {
  const normalized = typeof value === "number" && value < 1e12 ? value * 1000 : value;
  const ms = new Date(normalized || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function threadActiveFlags(thread = {}) {
  return Array.isArray(thread?.status?.activeFlags)
    ? thread.status.activeFlags.map((flag) => String(flag || "").trim().toLowerCase()).filter(Boolean)
    : [];
}

export function threadHasActiveTurn(thread = {}) {
  if (!thread) {
    return false;
  }

  if (String(thread.activeTurnId || "").trim()) {
    return true;
  }

  const flags = threadActiveFlags(thread);
  return [thread.activeTurnStatus, thread.status, thread.lastTurnStatus]
    .map(threadStatusValue)
    .some((status) => (
      status === "inprogress" ||
      status === "running" ||
      (status === "active" && !flags.includes("waitingonuserinput"))
    ));
}

export function threadPreviewSummary(thread = {}) {
  const preview = String(thread?.preview || "").replace(/\s+/g, " ").trim();
  if (!preview || looksLikeTopicNoise(preview)) {
    return "";
  }

  if (/^Warning: The maximum number of unified exec processes\b/i.test(preview)) {
    return "";
  }

  return preview;
}

export function activeThreadSummaries(threads = [], { selectedThreadId = "" } = {}) {
  const normalizedSelectedThreadId = String(selectedThreadId || "").trim();

  return (Array.isArray(threads) ? threads : [])
    .filter((thread) => thread?.id && threadHasActiveTurn(thread))
    .map((thread) => ({
      ...thread,
      isSelected: thread.id === normalizedSelectedThreadId,
      summaryPreview: threadPreviewSummary(thread)
    }))
    .sort((left, right) => (
      Number(right.isSelected) - Number(left.isSelected) ||
      threadTimestampValue(right.updatedAt) - threadTimestampValue(left.updatedAt)
    ));
}

const RECENT_WORKER_ACTIVITY_WINDOW_MS = 3 * 60 * 1000;

export function threadStatusLabel(thread = {}, {
  nowMs = Date.now(),
  recentWorkerWindowMs = RECENT_WORKER_ACTIVITY_WINDOW_MS
} = {}) {
  const lastWorkerActivityAt = threadTimestampValue(
    thread?.statusWorkerActivityAt || thread?.lastWorkerActivityAt || 0
  );
  const lastUserActivityAt = threadTimestampValue(
    thread?.statusUserActivityAt || thread?.lastUserActivityAt || 0
  );
  const hasRecentWorkerActivity =
    lastWorkerActivityAt > 0 &&
    nowMs - lastWorkerActivityAt <= recentWorkerWindowMs &&
    lastWorkerActivityAt >= lastUserActivityAt;
  const flags = threadActiveFlags(thread);
  if (flags.includes("waitingonuserinput")) {
    return hasRecentWorkerActivity ? "waiting" : "";
  }

  if (threadHasActiveTurn(thread)) {
    return "running";
  }

  if (hasRecentWorkerActivity) {
    return "working";
  }

  return "";
}

export function statusThreadSummaries(threads = [], {
  nowMs = Date.now(),
  recentWorkerWindowMs = RECENT_WORKER_ACTIVITY_WINDOW_MS,
  selectedThreadId = ""
} = {}) {
  const normalizedSelectedThreadId = String(selectedThreadId || "").trim();
  const priority = {
    waiting: 0,
    running: 1,
    working: 2
  };

  return (Array.isArray(threads) ? threads : [])
    .map((thread) => ({
      ...thread,
      isSelected: thread?.id === normalizedSelectedThreadId,
      statusLabel: threadStatusLabel(thread, { nowMs, recentWorkerWindowMs }),
      summaryPreview: threadPreviewSummary(thread)
    }))
    .filter((thread) => {
      if (!thread?.id || !thread.statusLabel) {
        return false;
      }

      if (thread.isSelected && !["running", "waiting", "working"].includes(thread.statusLabel)) {
        return false;
      }

      return true;
    })
    .sort((left, right) => (
      Number(right.isSelected) - Number(left.isSelected) ||
      (priority[left.statusLabel] ?? 10) - (priority[right.statusLabel] ?? 10) ||
      threadTimestampValue(right.updatedAt) - threadTimestampValue(left.updatedAt)
    ));
}

export function shouldHideTranscriptEntry(entry) {
  const text = normalizeTranscriptSource(entry?.text);
  return (
    !text ||
    /^[.]+$/.test(text) ||
    text.startsWith("Heartbeat:") ||
    text.startsWith("Capability ladder updated.") ||
    text.startsWith("Warning: The maximum number of unified exec processes") ||
    looksLikeInternalContextEnvelope(text)
  );
}

export function isSystemNoticeEntry(entry) {
  return (
    entry?.kind === "control_notice" ||
    entry?.kind === "surface_notice" ||
    entry?.kind === "selection_notice"
  );
}

export function setPanelHidden(node, hidden) {
  if (!node) {
    return;
  }

  const nextHidden = Boolean(hidden);
  node.classList.toggle("panel-hidden", nextHidden);
  node.hidden = nextHidden;
  if (nextHidden) {
    node.setAttribute("aria-hidden", "true");
  } else {
    node.removeAttribute("aria-hidden");
  }
}

export function sanitizeTranscriptText(text) {
  return String(text || "")
    .replace(/\[image\]\s+data:image\/[^\s)]+/g, "[image attachment]")
    .replace(/data:image\/[A-Za-z0-9+/=;:._-]+/g, "[image attachment]");
}

export function renderInlineMarkdown(value) {
  let html = escapeHtml(value);

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    if (/^https?:\/\//.test(url)) {
      return `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
    }

    return `<span class="inline-link">${label}</span>`;
  });

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  return html;
}

export function renderTranscriptText(text) {
  return sanitizeTranscriptText(text)
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${renderInlineMarkdown(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

export function displayTranscriptText(entry, { expanded = false } = {}) {
  const source = entry?.role === "tool" ? normalizeToolSource(entry?.text) : normalizeTranscriptSource(entry?.text);
  if (!source) {
    return "";
  }

  if (entry?.role !== "tool") {
    return source;
  }

  if (expanded) {
    return formatExpandedToolText(source);
  }

  const compactToolText = compactToolEnvelopeText(source);
  if (!compactToolText) {
    return "";
  }

  if (compactToolText.length <= 140) {
    return compactToolText;
  }

  return `${compactToolText.slice(0, 137).trimEnd()}...`;
}

function normalizeTranscriptSource(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function firstMeaningfulLine(text) {
  return (
    normalizeTranscriptSource(text)
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}

function looksLikeInternalContextEnvelope(text) {
  const normalized = normalizeTranscriptSource(text);
  if (!normalized) {
    return false;
  }

  const firstLine = firstMeaningfulLine(normalized);
  if (
    /^<(permissions instructions|app-context|collaboration_mode|skills_instructions|environment_context)>$/i.test(firstLine) ||
    /^<INSTRUCTIONS>$/i.test(firstLine) ||
    /^# AGENTS\.md instructions for /i.test(firstLine) ||
    /^# Internal workflow instructions for /i.test(firstLine) ||
    /^# File: ~\/\.codex\/AGENTS\.md$/i.test(firstLine) ||
    /^Filesystem sandboxing defines which files can be read or written\./i.test(firstLine)
  ) {
    return true;
  }

  return false;
}

function normalizeToolSource(value) {
  if (typeof value === "string") {
    return normalizeTranscriptSource(value);
  }

  const flattened = flattenToolEnvelopeValue(value)
    .map((item) => normalizeTranscriptSource(item))
    .filter(Boolean);
  if (flattened.length) {
    return flattened.join("\n").trim();
  }

  try {
    return normalizeTranscriptSource(JSON.stringify(value));
  } catch {
    return normalizeTranscriptSource(String(value || ""));
  }
}

function formatExpandedToolText(text) {
  const source = String(text || "").trim();
  if (!source) {
    return "";
  }

  const unwrapped = unwrapToolEnvelopeText(source);
  if (looksLikePlaywrightToolText(unwrapped)) {
    return formatExpandedPlaywrightToolText(unwrapped) || compactToolEnvelopeText(source) || unwrapped;
  }

  return unwrapped || source;
}

function compactToolEnvelopeText(text) {
  const trimmed = String(text || "").trim();
  const unwrapped = unwrapToolEnvelopeText(trimmed);
  const lines = unwrapped
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeToolLine(line))
    .filter(Boolean);

  const updatedFilesIndex = lines.findIndex((line) => /^success\. updated the following files:?$/i.test(line));
  if (updatedFilesIndex >= 0) {
    const fileLines = lines
      .slice(updatedFilesIndex + 1)
      .filter((line) => /^(A|M|D|R)\s+.+/.test(line))
      .map((line) => line.replace(/^(A|M|D|R)\s+/, "").trim());
    if (fileLines.length) {
      const labels = fileLines.slice(0, 3).map((path) => path.split("/").filter(Boolean).at(-1) || path);
      const suffix = fileLines.length > 3 ? ` (+${fileLines.length - 3} more)` : "";
      return `Updated files: ${labels.join(", ")}${suffix}`;
    }
  }

  const playwrightSummary = summarizePlaywrightToolLines(lines);
  if (playwrightSummary) {
    return playwrightSummary;
  }

  const outputIndex = lines.findIndex((line) => line.toLowerCase() === "output:");
  if (outputIndex >= 0) {
    const meaningfulOutput = lines
      .slice(outputIndex + 1)
      .find((line) => line && !isToolWrapperLine(line));
    if (meaningfulOutput) {
      return meaningfulOutput;
    }
  }

  const firstMeaningfulLine = lines.find((line) => line && !isToolWrapperLine(line));
  if (firstMeaningfulLine) {
    return firstMeaningfulLine;
  }

  return unwrapped;
}

function unwrapToolEnvelopeText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return "";
  }

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const flattened = flattenToolEnvelopeValue(parsed).filter((value) => value && value.trim());
    if (flattened.length) {
      const next = flattened.join("\n").trim();
      return next && next !== trimmed ? unwrapToolEnvelopeText(next) : next;
    }
  } catch {}

  const decoded = decodeEscapedToolText(trimmed);
  if (decoded !== trimmed) {
    return unwrapToolEnvelopeText(decoded);
  }

  const partialEnvelopeText = extractPartialToolEnvelopeText(trimmed);
  if (partialEnvelopeText) {
    return partialEnvelopeText;
  }

  return trimmed;
}

function decodeEscapedToolText(text) {
  const value = String(text || "").trim();
  if (!value || (!value.includes("\\n") && !value.includes('\\"') && !value.includes("\\t"))) {
    return value;
  }

  try {
    return value
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  } catch {
    return value;
  }
}

function flattenToolEnvelopeValue(value) {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenToolEnvelopeValue(item));
  }

  if (value && typeof value === "object") {
    for (const key of ["text", "output", "stdout", "stderr", "message", "command"]) {
      const next = value[key];
      if (next != null) {
        const flattened = flattenToolEnvelopeValue(next);
        if (flattened.length) {
          return flattened;
        }
      }
    }

    return Object.values(value).flatMap((item) => flattenToolEnvelopeValue(item));
  }

  return [];
}

function extractPartialToolEnvelopeText(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return "";
  }

  for (const key of ["text", "output", "message", "stdout", "stderr"]) {
    const directClosedMatch = normalized.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"])*)"`, "i"));
    if (directClosedMatch?.[1]) {
      return decodePartialToolString(directClosedMatch[1]);
    }

    const escapedClosedMatch = normalized.match(new RegExp(`\\\\"${key}\\\\"\\s*:\\s*\\\\"((?:\\\\\\\\.|[^"])*)\\\\"`, "i"));
    if (escapedClosedMatch?.[1]) {
      return decodePartialToolString(escapedClosedMatch[1]);
    }

    const directMatch = normalized.match(new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*)$`, "i"));
    if (directMatch?.[1]) {
      return decodePartialToolString(directMatch[1]);
    }

    const escapedMatch = normalized.match(new RegExp(`\\\\"${key}\\\\"\\s*:\\s*\\\\"([\\s\\S]*)$`, "i"));
    if (escapedMatch?.[1]) {
      return decodePartialToolString(escapedMatch[1]);
    }
  }

  return "";
}

function decodePartialToolString(value) {
  const decoded = String(value || "")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .trim();

  if (decoded.includes("```") && !/```[\s\S]*```/.test(decoded)) {
    return decoded.replace(/```[\s\S]*$/, "").trim();
  }

  return decoded;
}

function normalizeToolLine(line) {
  const normalized = String(line || "").trim();
  if (!normalized) {
    return "";
  }

  if (normalized === "```" || normalized.startsWith("```")) {
    return "";
  }

  if (/^#{1,6}\s+/.test(normalized)) {
    return normalized.replace(/^#{1,6}\s+/, "").trim();
  }

  if (/^-\s+/.test(normalized)) {
    return normalized.replace(/^-\s+/, "").trim();
  }

  return normalized;
}

function isToolWrapperLine(line) {
  const normalized = String(line || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    normalized.startsWith("command:") ||
    normalized.startsWith("chunk id:") ||
    normalized.startsWith("wall time:") ||
    normalized.startsWith("process exited") ||
    normalized.startsWith("original token count:") ||
    normalized === "output:" ||
    normalized === "page" ||
    normalized === "snapshot"
  );
}

function summarizePlaywrightToolLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "";
  }

  const ranCode = lines.find((line) => /ran playwright code/i.test(line));
  if (ranCode) {
    const pageUrl = lines.find((line) => /^page url:/i.test(line));
    if (pageUrl) {
      return `Ran Playwright code // ${pageUrl.replace(/^page url:\s*/i, "").trim()}`;
    }
    return "Ran Playwright code";
  }

  const resultLine = lines.find((line) => /^result$/i.test(line));
  if (resultLine) {
    return "Playwright result";
  }

  const openTabsLine = lines.find((line) => /^open tabs$/i.test(line));
  if (openTabsLine) {
    return "Open tabs";
  }

  const pageUrl = lines.find((line) => /^page url:/i.test(line));
  if (pageUrl) {
    return `Page URL: ${pageUrl.replace(/^page url:\s*/i, "").trim()}`;
  }

  return "";
}

function looksLikePlaywrightToolText(text) {
  const normalized = String(text || "");
  return (
    /ran playwright code/i.test(normalized) ||
    /^page url:/im.test(normalized) ||
    /^###\s+page/im.test(normalized) ||
    /^###\s+open tabs/im.test(normalized) ||
    /^###\s+result/im.test(normalized) ||
    /^open tabs$/im.test(normalized) ||
    /^result$/im.test(normalized)
  );
}

function formatExpandedPlaywrightToolText(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const sections = [];
  const summary = compactToolEnvelopeText(normalized);
  if (summary) {
    sections.push(summary);
  }

  const codeBlock = extractFirstMarkdownCodeBlock(normalized);
  if (codeBlock) {
    sections.push(codeBlock);
  }

  const pageLines = [];
  const pageUrl = extractPrefixedLine(normalized, "Page URL:");
  if (pageUrl) {
    pageLines.push(`Page URL: ${pageUrl}`);
  }
  const pageTitle = extractPrefixedLine(normalized, "Page Title:");
  if (pageTitle) {
    pageLines.push(`Page Title: ${pageTitle}`);
  }
  if (pageLines.length) {
    sections.push(pageLines.join("\n"));
  }

  return sections.filter(Boolean).join("\n\n").trim();
}

function extractFirstMarkdownCodeBlock(text) {
  const match = decodeEscapedToolText(String(text || "")).match(/```[^\n]*\n([\s\S]*?)```/);
  return match?.[1]?.trim() || "";
}

function extractPrefixedLine(text, prefix) {
  const pattern = new RegExp(`^\\s*[-*]?\\s*${escapeRegExp(prefix)}\\s*(.+)$`, "im");
  const match = String(text || "").match(pattern);
  return match?.[1]?.trim() || "";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isTranscriptCardExpandable(entry) {
  const text = String(entry?.text || "").trim();
  if (!text) {
    return false;
  }

  return text.length > 220 || text.split("\n").length > 5;
}

function previewClampLines(entry, { expanded = false } = {}) {
  if (expanded || !isTranscriptCardExpandable(entry)) {
    return 0;
  }

  if (entry?.participant?.role === "advisory") {
    return 1;
  }

  if (entry?.role === "tool") {
    return 1;
  }

  if (entry?.role === "assistant" && entry?.kind === "commentary") {
    return 1;
  }

  if (entry?.kind === "pending" || entry?.kind === "queued") {
    return 1;
  }

  return 3;
}

export function shouldClampCardPreview(entry, { expanded = false } = {}) {
  return previewClampLines(entry, { expanded }) > 0;
}

export function formatCardLabel(entry) {
  if (entry?.participant?.label) {
    return entry.participant.label;
  }

  if (entry.kind === "pending") {
    return "sending";
  }

  if (entry.kind === "queued") {
    return "queued";
  }

  if (entry.role === "user") {
    return "you";
  }

  if (entry.role === "assistant" && entry.kind === "commentary") {
    return "update";
  }

  if (entry.role === "assistant") {
    return "codex";
  }

  if (entry.kind === "context_compaction") {
    return "context";
  }

  if (entry.kind === "control_notice") {
    return "control";
  }

  if (entry.kind === "surface_notice") {
    return "presence";
  }

  if (entry.kind === "selection_notice") {
    return "room";
  }

  if (entry.role === "tool") {
    return "tool";
  }

  return humanize(entry.kind || entry.role || "event");
}

export function formatOriginLabel(origin) {
  if (!origin) {
    return "";
  }

  if (origin === "remote") {
    return "remote lane";
  }

  if (origin === "desktop" || origin === "host") {
    return "desktop lane";
  }

  if (origin === "external") {
    return "external client";
  }

  return `${humanize(origin)} lane`;
}

function participantCapabilityLabel(participant, { controlLane = "" } = {}) {
  if (!participant) {
    return "";
  }

  if (controlLane && participant.lane && participant.lane === controlLane) {
    return "keyboard";
  }

  if (participant.metaLabel) {
    return participant.metaLabel;
  }

  if (participant.capability === "advisory" || participant.role === "advisory") {
    return "advisory";
  }

  if (participant.canAct || participant.capability === "write") {
    return "writable";
  }

  if (participant.role === "tool") {
    return "tool";
  }

  return "observe";
}

export function renderParticipantRoster(participants, { controlLane = "" } = {}) {
  const items = (participants || [])
    .filter((participant) => participant && participant.role !== "system")
    .map((participant) => ({
      capability: participantCapabilityLabel(participant, { controlLane }),
      id: participant.id || participant.label || "",
      label: participant.displayLabel || participant.label || participant.id || "voice",
      state: participant.state || "",
      token: participant.token || "system"
    }))
    .filter((participant) => participant.id);

  const signature = JSON.stringify({
    controlLane,
    items
  });

  if (!items.length) {
    return {
      html: "",
      signature
    };
  }

  const html = items
    .map((participant) => {
      const classes = ["participant-pill", `participant-pill-${participant.token}`];
      if (participant.capability === "keyboard") {
        classes.push("is-keyboard");
      }
      if (participant.state) {
        classes.push(`is-${participant.state}`);
      }

      return `
        <span class="${classes.join(" ")}">
          <span class="participant-pill-label">${escapeHtml(participant.label)}</span>
          <span class="participant-pill-meta">${escapeHtml(participant.capability)}</span>
        </span>
      `;
    })
    .join("");

  return {
    html,
    signature
  };
}

export function formatCardNote(entry) {
  if (entry.note) {
    return entry.note;
  }

  if (entry.kind === "pending") {
    return "sending";
  }

  if (entry.kind === "queued") {
    return Number.isFinite(entry.queuePosition) ? `slot ${entry.queuePosition}` : "queued";
  }

  if (entry.role === "assistant" && entry.kind === "commentary") {
    if (entry.participant?.role === "advisory") {
      return entry.wakeKind === "review" ? "review" : "recap";
    }
    return "";
  }

  if (entry.role === "assistant" && (entry.lane || entry.origin)) {
    return `reply via ${formatOriginLabel(entry.lane || entry.origin)}`;
  }

  if (entry.role === "assistant" || entry.role === "user") {
    return "";
  }

  if (entry.role === "tool") {
    return "";
  }

  if (entry.kind === "context_compaction") {
    return "history compacted";
  }

  if (entry.kind === "control_notice") {
    return entry.note || "control handoff";
  }

  if (entry.kind === "surface_notice") {
    return entry.note || "surface change";
  }

  if (entry.kind === "selection_notice") {
    return entry.note || "room change";
  }

  return humanize(entry.kind || entry.role || "event");
}

export function isConversationEntry(entry) {
  if (entry.role === "user") {
    return true;
  }

  return entry.role === "assistant" && entry.kind !== "commentary";
}

function summarySpeakerLabel(entry) {
  if (!entry) {
    return "update";
  }

  if (entry.role === "user") {
    return "you";
  }

  if (entry.role === "assistant") {
    return entry?.participant?.label || "codex";
  }

  return entry?.participant?.label || entry?.lane || humanize(entry?.role || entry?.kind || "update");
}

function normalizeSummaryText(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeRecentTranscript(entries, { limit = 2, maxLength = 180 } = {}) {
  const allEntries = Array.isArray(entries) ? entries : [];
  const meaningful = allEntries.filter((entry) => String(entry?.text || "").trim() && !shouldHideTranscriptEntry(entry));
  const preferredEntries = meaningful.filter((entry) => isConversationEntry(entry));
  const sourceEntries = preferredEntries.length
    ? preferredEntries
    : meaningful.filter((entry) => !isSystemNoticeEntry(entry));
  const recentEntries = sourceEntries.slice(-Math.max(1, limit));

  if (!recentEntries.length) {
    return "";
  }

  const summary = recentEntries
    .map((entry) => {
      const speaker = summarySpeakerLabel(entry);
      const text = normalizeSummaryText(entry?.text || "");
      return `${speaker}: ${text}`;
    })
    .join(" | ");

  if (summary.length <= maxLength) {
    return summary;
  }

  return `${summary.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function isAdvisoryEntry(entry) {
  return entry?.participant?.role === "advisory";
}

function isTimelineMarkerEntry(entry) {
  return (
    entry?.kind === "context_compaction" ||
    entry?.kind === "control_notice" ||
    entry?.kind === "surface_notice" ||
    entry?.kind === "selection_notice"
  );
}

export function shouldRenderOriginBadge(entry) {
  if (!entry?.participant?.lane && !entry?.lane && !entry?.origin) {
    return false;
  }

  if (entry.kind === "pending" || entry.kind === "queued") {
    return true;
  }

  if (entry.role === "assistant" && (entry.lane || entry.origin)) {
    return true;
  }

  return false;
}

function normalizeEntryText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function entryTimestampBucket(value = "") {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) {
    return "";
  }

  return String(Math.floor(ms / 1000));
}

export function entryDedupKey(entry) {
  if (entry?.itemId) {
    return `item:${entry.itemId}`;
  }

  const text = normalizeEntryText(entry?.text || "");
  if (text) {
    return [
      entry?.role || "",
      entry?.kind || "",
      entryTimestampBucket(entry?.timestamp || ""),
      text
    ].join("|");
  }

  return [
    entry?.id || "",
    entry?.turnId || "",
    entry?.role || "",
    entry?.kind || "",
    entry?.timestamp || ""
  ].join("|");
}

function normalizedTranscriptOrder(entry) {
  const order = Number(entry?.transcriptOrder);
  return Number.isFinite(order) ? order : null;
}

function normalizedEntryTimestamp(entry) {
  const ms = new Date(entry?.timestamp || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function compareEntryChronology(left, right) {
  const leftOrder = normalizedTranscriptOrder(left);
  const rightOrder = normalizedTranscriptOrder(right);
  if (leftOrder != null && rightOrder != null && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftTimestamp = normalizedEntryTimestamp(left);
  const rightTimestamp = normalizedEntryTimestamp(right);
  if (leftTimestamp != null && rightTimestamp != null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }

  if (leftOrder != null && rightOrder == null) {
    return -1;
  }
  if (leftOrder == null && rightOrder != null) {
    return 1;
  }

  if (leftTimestamp != null && rightTimestamp == null) {
    return -1;
  }
  if (leftTimestamp == null && rightTimestamp != null) {
    return 1;
  }

  return 0;
}

export function compareEntryChronologyDesc(left, right) {
  return compareEntryChronology(right, left);
}

export function entryKey(entry) {
  return [
    entry.id || "",
    entry.turnId || "",
    entry.itemId || "",
    entryDedupKey(entry)
  ].join("|");
}

export function renderTranscriptCard(entry, { expanded = false, isNew = false } = {}) {
  const classes = ["transcript-card", `transcript-${entry.role}`];
  if (entry.role === "assistant" && entry.kind === "commentary") {
    classes.push("transcript-commentary");
  }
  if (isTimelineMarkerEntry(entry)) {
    classes.push("transcript-marker");
  }
  if (entry?.participant?.token) {
    classes.push(`participant-${entry.participant.token}`);
  }
  if (entry.kind === "control_notice") {
    classes.push("transcript-control-marker");
  }
  if (entry.kind === "surface_notice") {
    classes.push("transcript-surface-marker");
  }
  if (entry.kind === "selection_notice") {
    classes.push("transcript-selection-marker");
  }
  if (shouldRenderOriginBadge(entry)) {
    classes.push(`transcript-origin-${entry.lane || entry.origin}`);
  }
  const expandable = isTranscriptCardExpandable(entry);
  if (expandable) {
    classes.push("card-expandable");
  }
  if (expanded) {
    classes.push("card-expanded");
  }
  const clampLines = previewClampLines(entry, { expanded });
  if (clampLines > 0) {
    classes.push("card-clamped");
    classes.push(`card-clamp-${clampLines}`);
  }
  if (isNew) {
    classes.push("card-new");
  }

  const note = formatCardNote(entry);
  const timestamp = formatTimestamp(entry.timestamp);
  const origin = shouldRenderOriginBadge(entry) ? formatOriginLabel(entry.participant?.lane || entry.lane || entry.origin) : "";
  const key = entryKey(entry);
  const actions = Array.isArray(entry.actions) ? entry.actions : [];
  const actionBusy = Boolean(entry.actionState?.busy);
  const actionButtons = actions.length
    ? `
        <div class="card-actions">
          ${actions
            .map((action) => {
              const isBusy = actionBusy && entry.actionState?.action === action.action;
              const classes = ["transcript-action"];
              if (action.tone === "danger") {
                classes.push("is-danger");
              } else if (action.tone === "success") {
                classes.push("is-success");
              }
              if (isBusy) {
                classes.push("is-busy");
              }
              const actionDisabled = actionBusy || Boolean(action.disabled);

              return `
                <button
                  type="button"
                  class="${classes.join(" ")}"
                  data-companion-action="${escapeHtml(action.action)}"
                  data-wake-key="${escapeHtml(entry.key || "")}"
                  data-advisor-id="${escapeHtml(entry.advisorId || "")}"
                  ${actionDisabled ? "disabled" : ""}
                >${escapeHtml(isBusy ? action.busyLabel || action.label : action.label)}</button>
              `;
            })
            .join("")}
        </div>
      `
    : "";

  return `
    <article
      class="${classes.join(" ")}"
      data-entry-key="${escapeHtml(key)}"
      data-expandable="${expandable ? "true" : "false"}"
      ${expandable ? `tabindex="0" aria-expanded="${expanded ? "true" : "false"}"` : ""}
    >
      <div class="card-head">
        <div class="card-meta">
          <span class="card-label">${escapeHtml(formatCardLabel(entry))}</span>
          ${origin ? `<span class="card-origin">${escapeHtml(origin)}</span>` : ""}
        </div>
        <div class="card-tail">
          ${timestamp ? `<time class="card-time">${escapeHtml(timestamp)}</time>` : ""}
          ${expandable && !expanded ? '<span class="card-expand-hint" aria-hidden="true">...</span>' : ""}
        </div>
      </div>
      ${note ? `<div class="card-note">${escapeHtml(note)}</div>` : ""}
      <div class="transcript-copy">${renderTranscriptText(displayTranscriptText(entry, { expanded }))}</div>
      ${actionButtons}
    </article>
  `;
}

export function renderChangeCard(change, { open = false } = {}) {
  const meta = [
    change.kind ? humanize(change.kind) : null,
    Number.isFinite(change.additions) ? `+${change.additions}` : null,
    Number.isFinite(change.deletions) ? `-${change.deletions}` : null
  ]
    .filter(Boolean)
    .join(" / ");

  const renameNote =
    change.fromPath && change.fromPath !== change.path
      ? `<div class="change-note">${escapeHtml(change.fromPath)} -> ${escapeHtml(change.path)}</div>`
      : "";
  const relevanceNote = change.relevance
    ? `<div class="change-relevance">${escapeHtml(change.relevance)}</div>`
    : "";

  return `
    <details class="change-card"${open ? " open" : ""}>
      <summary class="change-summary">
        <span class="change-path">${escapeHtml(change.path || "unknown")}</span>
        <span class="change-meta">${escapeHtml(meta || change.statusCode || "changed")}</span>
      </summary>
      ${relevanceNote}
      ${renameNote}
      <pre class="diff-block">${escapeHtml(change.diffPreview || "No diff preview.")}</pre>
    </details>
  `;
}

function applySelectState(select, normalizedOptions, normalizedSelectedValue, signature) {
  select.innerHTML = "";

  for (const option of normalizedOptions) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === normalizedSelectedValue;
    select.append(node);
  }

  select.dataset.renderSignature = signature;
  delete select.dataset.pendingRenderSignature;
  select.__pendingSelectState = null;
}

function isSelectInteracting(select) {
  const interactiveUntil = Number(select.dataset.interactingUntil || "0");
  return document.activeElement === select || interactiveUntil > Date.now();
}

function flushPendingSelectState(select) {
  const pending = select.__pendingSelectState;
  if (!pending || isSelectInteracting(select)) {
    return;
  }

  applySelectState(select, pending.options, pending.selectedValue, pending.signature);
}

function ensureStableSelect(select) {
  if (select.__stableSelectInitialized) {
    return;
  }

  select.__stableSelectInitialized = true;

  const markInteractive = (ms = 1400) => {
    select.dataset.interactingUntil = String(Date.now() + ms);
  };

  const releaseSoon = (ms = 180) => {
    markInteractive(ms);
    window.setTimeout(() => flushPendingSelectState(select), ms + 20);
  };

  select.addEventListener("pointerdown", () => markInteractive(), true);
  select.addEventListener("mousedown", () => markInteractive(), true);
  select.addEventListener("touchstart", () => markInteractive(), true);
  select.addEventListener("focus", () => markInteractive(), true);
  select.addEventListener("keydown", () => markInteractive(900), true);
  select.addEventListener("change", () => releaseSoon(120), true);
  select.addEventListener("blur", () => releaseSoon(), true);
}

export function populateSelect(select, options, selectedValue) {
  ensureStableSelect(select);
  const normalizedOptions = (options || []).map((option) => ({
    label: String(option.label ?? ""),
    value: String(option.value ?? "")
  }));
  const normalizedSelectedValue = String(selectedValue ?? "");
  const signature = JSON.stringify({
    options: normalizedOptions,
    selectedValue: normalizedSelectedValue
  });

  if (select.dataset.renderSignature === signature) {
    return;
  }

  if (isSelectInteracting(select)) {
    select.__pendingSelectState = {
      options: normalizedOptions,
      selectedValue: normalizedSelectedValue,
      signature
    };
    select.dataset.pendingRenderSignature = signature;
    return;
  }

  applySelectState(select, normalizedOptions, normalizedSelectedValue, signature);
}

export function setHtmlIfChanged(node, html, signature = html) {
  if (!node) {
    return false;
  }

  if (node.__renderSignature === signature) {
    return false;
  }

  node.innerHTML = html;
  node.__renderSignature = signature;
  return true;
}

export function clearHtmlRenderState(node) {
  if (!node) {
    return false;
  }

  node.innerHTML = "";
  node.__renderSignature = null;
  return true;
}

function renderKeySelector(value) {
  if (window.CSS?.escape) {
    return `[data-render-key="${window.CSS.escape(value)}"]`;
  }

  return `[data-render-key="${String(value).replaceAll('"', '\\"')}"]`;
}

function createRenderedNode(html, key, signature) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "").trim();
  const node = template.content.firstElementChild;
  if (!node) {
    return null;
  }

  node.dataset.renderKey = key;
  node.__renderSignature = signature;
  return node;
}

function captureViewportAnchor(container) {
  if (!container) {
    return null;
  }

  const children = Array.from(container.children);
  const anchorNode = children.find((child) => child.getBoundingClientRect().bottom > 0) || children[0] || null;
  if (!anchorNode?.dataset?.renderKey) {
    return null;
  }

  return {
    key: anchorNode.dataset.renderKey,
    top: anchorNode.getBoundingClientRect().top
  };
}

function restoreViewportAnchor(container, anchor) {
  if (!container || !anchor?.key) {
    return;
  }

  const node = container.querySelector(renderKeySelector(anchor.key));
  if (!node) {
    return;
  }

  const nextTop = node.getBoundingClientRect().top;
  const delta = nextTop - anchor.top;
  if (delta) {
    window.scrollBy(0, delta);
  }
}

export function reconcileRenderedList(container, items = []) {
  if (!container) {
    return false;
  }

  const existing = new Map(
    Array.from(container.children)
      .filter((child) => child?.dataset?.renderKey)
      .map((child) => [child.dataset.renderKey, child])
  );
  const anchor = captureViewportAnchor(container);
  const fragment = document.createDocumentFragment();
  let changed = false;

  for (const item of items) {
    const key = String(item?.key || "");
    if (!key) {
      continue;
    }

    let node = existing.get(key) || null;
    if (!node || node.__renderSignature !== item.signature) {
      const nextNode = createRenderedNode(item.html, key, item.signature);
      if (!nextNode) {
        continue;
      }
      changed = true;
      if (node) {
        node.replaceWith(nextNode);
      }
      node = nextNode;
    }

    existing.delete(key);
    fragment.append(node);
  }

  if (existing.size) {
    changed = true;
    for (const node of existing.values()) {
      node.remove();
    }
  }

  if (container.childNodes.length !== items.length || Array.from(container.children).some((child, index) => child.dataset.renderKey !== items[index]?.key)) {
    changed = true;
  }

  if (!changed) {
    return false;
  }

  container.replaceChildren(fragment);
  restoreViewportAnchor(container, anchor);
  return true;
}

export function startTicker(
  node,
  phrases,
  { typeDelay = 34, eraseDelay = 14, holdMs = 1200, loop = false } = {}
) {
  if (!node || !phrases?.length) {
    return {
      setText() {}
    };
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    node.textContent = phrases[0];
    node.classList.add("is-static");
    return {
      setText(text) {
        node.textContent = text;
        node.classList.add("is-static");
      }
    };
  }

  let phraseIndex = 0;
  let charIndex = 0;
  let mode = "typing";
  let settledText = String(node.textContent || "");
  let timeoutId = null;
  let stopped = false;
  let transitionAnimation = null;

  function queue(nextDelay) {
    timeoutId = window.setTimeout(tick, nextDelay);
  }

  function settle(text, { animate = false } = {}) {
    stopped = true;
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    const nextText = String(text || "");
    if (settledText === nextText && node.classList.contains("is-static")) {
      return;
    }
    settledText = nextText;
    node.textContent = nextText;
    node.classList.add("is-static");
    if (animate && typeof node.animate === "function") {
      try {
        transitionAnimation?.cancel();
        transitionAnimation = node.animate(
          [
            { filter: "blur(0.8px)", opacity: 0.58, transform: "translateY(1px)" },
            { filter: "blur(0px)", opacity: 1, transform: "translateY(0)" }
          ],
          {
            duration: 180,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)"
          }
        );
        transitionAnimation.addEventListener("finish", () => {
          transitionAnimation = null;
        }, { once: true });
      } catch {
        transitionAnimation = null;
      }
    }
  }

  function tick() {
    if (stopped) {
      return;
    }

    const phrase = phrases[phraseIndex];

    if (mode === "typing") {
      charIndex += 1;
      node.textContent = phrase.slice(0, charIndex);
      if (charIndex < phrase.length) {
        queue(typeDelay);
        return;
      }
      mode = "holding";
      queue(holdMs);
      return;
    }

    if (mode === "holding") {
      if (!loop && phraseIndex === phrases.length - 1) {
        settle(phrase);
        return;
      }
      mode = "erasing";
      queue(eraseDelay);
      return;
    }

    charIndex -= 1;
    node.textContent = phrase.slice(0, charIndex);
    if (charIndex > 0) {
      queue(eraseDelay);
      return;
    }

    mode = "typing";
    phraseIndex = loop ? (phraseIndex + 1) % phrases.length : Math.min(phraseIndex + 1, phrases.length - 1);
    queue(180);
  }

  node.classList.remove("is-static");
  tick();

  return {
    setText(text) {
      settle(text, { animate: true });
    }
  };
}
