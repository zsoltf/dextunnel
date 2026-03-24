import {
  clearHtmlRenderState,
  currentSurfaceTranscript,
  createRequestError,
  describeOperatorDiagnostics,
  describeDesktopSyncNote,
  describeThreadState,
  entryKey,
  escapeHtml,
  formatRecoveryDuration,
  getSurfaceBootstrap,
  groupThreadsByProject,
  humanize,
  isConversationEntry,
  isSystemNoticeEntry,
  mergeSurfaceAttachments,
  populateSelect,
  projectLabel,
  reconcileRenderedList,
  renderChangeCard,
  isAdvisoryEntry,
  renderParticipantRoster,
  setHtmlIfChanged,
  setPanelHidden,
  renderTranscriptCard,
  sessionLabel,
  shortThreadId,
  stableSurfaceClientId,
  shouldHideTranscriptEntry,
  startTicker,
  withSurfaceHeaders,
  withSurfaceTokenUrl
} from "./client-shared.js";
import {
  createSelectionIntent,
  reconcileSelectionIntent,
  selectionIntentMessage,
  selectionIntentTitle
} from "./live-selection-intent.js";
import {
  createLiveBridgeLifecycle,
  createLiveBridgeLifecycleState
} from "./live-bridge-lifecycle.js";
import { createSurfaceViewState } from "./surface-view-state.js";

const stateUrl = "/api/state";
const liveStateUrl = "/api/codex-app-server/live-state";
const refreshUrl = "/api/codex-app-server/refresh";
const selectionUrl = "/api/codex-app-server/selection";
const interactionUrl = "/api/codex-app-server/interaction";
const controlUrl = "/api/codex-app-server/control";
const companionUrl = "/api/codex-app-server/companion";
const debugInteractionUrl = "/api/debug/live-interaction";
const changesUrl = "/api/codex-app-server/changes";
const openInCodexUrl = "/api/codex-app-server/open-in-codex";
const presenceUrl = "/api/codex-app-server/presence";
const FALLBACK_REFRESH_INTERVAL_MS = 6000;
const FALLBACK_REFRESH_STALE_MS = 14000;
const HOST_INTENT_ACTIVE_WINDOW_MS = 45000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 12000;
const STREAM_RECOVERY_BASE_MS = 700;
const STREAM_RECOVERY_MAX_MS = 5000;
const BOOTSTRAP_RETRY_BASE_MS = 900;
const BOOTSTRAP_RETRY_MAX_MS = 6000;
const surfaceBootstrap = getSurfaceBootstrap("host");
const surfaceAuthClientId = surfaceBootstrap.clientId;
let currentSnapshot = null;
let currentLiveState = null;
let renderedThreadId = null;
let hasRenderedOnce = false;
let lastLiveActivityAt = 0;
let presenceSyncPromise = null;
let presenceSyncTimer = null;
let lastPresenceSignature = "";
let lastPresenceSyncAt = 0;
let currentChanges = null;
let changesRefreshPromise = null;
let changesRefreshTimer = null;
let actionHandoffState = null;
let actionHandoffTimer = null;
let streamIssueStartedAt = 0;
let transientUiNotice = null;
let transientUiNoticeTimer = null;
let companionActionState = null;
let lastUserIntentAt = Date.now();
let selectionIntent = null;
let selectionRequestVersion = 0;
const surfaceClientId = stableSurfaceClientId("host");
const surfaceViewState = createSurfaceViewState({
  defaults: {
    filters: {
      council: false,
      changes: true,
      thread: true,
      advisories: false,
      updates: false,
      tools: false
    }
  },
  scopeId: surfaceClientId,
  surface: "host"
});
const expandedFeedSections = new Set();
const expandedEntryKeys = new Set();
const seenCardKeys = new Set();
const seenCommandKeys = new Set();
const bridgeState = createLiveBridgeLifecycleState({
  bootstrapRetryBaseMs: BOOTSTRAP_RETRY_BASE_MS,
  streamRecoveryBaseMs: STREAM_RECOVERY_BASE_MS
});
const feedFilters = surfaceViewState.loadFilters();
const uiState = {
  booting: true,
  controlling: false,
  loadingChanges: false,
  openingDesktop: false,
  refreshing: false,
  selecting: false,
  submittingAction: false
};

const nodes = {
  actionButtons: document.querySelector("#host-action-buttons"),
  actionCancel: document.querySelector("#host-action-cancel"),
  actionCard: document.querySelector("#approval-card"),
  actionForm: document.querySelector("#host-action-form"),
  actionKind: document.querySelector("#host-action-kind"),
  actionPanel: document.querySelector("#host-approval-panel"),
  actionQuestions: document.querySelector("#host-action-questions"),
  approveSessionButton: document.querySelector("#host-approve-session-button"),
  actionSubmit: document.querySelector("#host-action-submit"),
  actionTitle: document.querySelector("#host-action-title"),
  approveButton: document.querySelector("#host-approve-button"),
  assistantForm: document.querySelector("#assistant-form"),
  assistantText: document.querySelector("#assistant-text"),
  commandLog: document.querySelector("#command-log"),
  declineButton: document.querySelector("#host-decline-button"),
  feed: document.querySelector("#transcript"),
  filterButtons: Array.from(document.querySelectorAll("[data-filter]")),
  hostControlIndicator: document.querySelector("#host-control-indicator"),
  hostDesktopSyncNote: document.querySelector("#host-desktop-sync-note"),
  hostDebugPanel: document.querySelector("#host-debug-panel"),
  hostOpenInCodexButton: document.querySelector("#host-open-in-codex-button"),
  hostOperatorDiagnostics: document.querySelector("#host-operator-diagnostics"),
  hostPath: document.querySelector("#host-path"),
  hostProjectSelect: document.querySelector("#host-project-select"),
  hostRefreshButton: document.querySelector("#host-refresh-button"),
  hostReleaseControlButton: document.querySelector("#host-release-control-button"),
  hostSessionSelect: document.querySelector("#host-session-select"),
  marquee: document.querySelector("#host-marquee"),
  sessionRoster: document.querySelector("#session-roster"),
  sessionSummary: document.querySelector("#session-summary"),
  sessionTitle: document.querySelector("#session-title"),
  sessionTopic: document.querySelector("#session-topic"),
  uiStatus: document.querySelector("#host-ui-status")
};

const marqueeTicker = startTicker(nodes.marquee, [
  "subscribing to selected thread...",
  "watching approvals and turn events...",
  "mirroring remote companion state..."
]);

function shortPathLabel(value) {
  const parts = String(value || "")
    .split("/")
    .filter(Boolean);

  return parts.at(-1) || value || "";
}

function markLiveActivity() {
  lastLiveActivityAt = Date.now();
}

function settleSelectionIntent() {
  if (!selectionIntent) {
    return false;
  }

  const result = reconcileSelectionIntent(selectionIntent, currentLiveState);
  selectionIntent = result.intent;
  if (result.settled) {
    uiState.selecting = false;
  }
  return result.settled;
}

function markUserIntent() {
  lastUserIntentAt = Date.now();
}

function currentThreadId() {
  return currentLiveState?.selectedThreadSnapshot?.thread?.id || currentLiveState?.selectedThreadId || "";
}

function hostEngaged() {
  return Boolean(
    currentLiveState?.pendingInteraction ||
      Date.now() - lastUserIntentAt <= HOST_INTENT_ACTIVE_WINDOW_MS
  );
}

function buildPresencePayload() {
  const threadId = currentThreadId();
  if (!threadId) {
    return null;
  }

  return {
    clientId: surfaceAuthClientId,
    engaged: hostEngaged(),
    focused: document.hasFocus(),
    surface: "host",
    threadId,
    visible: document.visibilityState === "visible"
  };
}

function localSurfaceAttachment() {
  const payload = buildPresencePayload();
  if (!payload) {
    return null;
  }

  return {
    count: 1,
    label: "host",
    state: payload.visible && payload.focused && payload.engaged ? "active" : payload.visible ? "open" : "background",
    surface: "host"
  };
}

function sendDetachPresence() {
  const threadId = currentThreadId() || currentLiveState?.selectedThreadId || "";
  if (!threadId) {
    return;
  }

  const payload = JSON.stringify({
    clientId: surfaceAuthClientId,
    detach: true,
    surface: "host",
    threadId
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      withSurfaceTokenUrl(presenceUrl, surfaceBootstrap.accessToken),
      new Blob([payload], { type: "application/json" })
    );
    return;
  }

  void fetch(presenceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

async function syncPresence({ force = false } = {}) {
  if (!force && bridgeState.streamState !== "live") {
    return null;
  }

  const payload = buildPresencePayload();
  if (!payload) {
    return null;
  }

  const signature = JSON.stringify(payload);
  if (!force && signature === lastPresenceSignature && Date.now() - lastPresenceSyncAt < PRESENCE_HEARTBEAT_INTERVAL_MS - 500) {
    return null;
  }

  if (presenceSyncPromise) {
    return presenceSyncPromise;
  }

  presenceSyncPromise = requestJson(presenceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then((response) => {
      lastPresenceSignature = signature;
      lastPresenceSyncAt = Date.now();
      return response;
    })
    .catch(() => null)
    .finally(() => {
      presenceSyncPromise = null;
    });

  return presenceSyncPromise;
}

function schedulePresenceSync(delayMs = 140, { force = false } = {}) {
  if (presenceSyncTimer) {
    window.clearTimeout(presenceSyncTimer);
  }

  presenceSyncTimer = window.setTimeout(() => {
    presenceSyncTimer = null;
    void syncPresence({ force });
  }, delayMs);
}

function setUiStatus(message = "", tone = "neutral") {
  nodes.uiStatus.textContent = message;
  setPanelHidden(nodes.uiStatus, !message);
  nodes.uiStatus.classList.toggle("is-busy", tone === "busy");
  nodes.uiStatus.classList.toggle("is-error", tone === "error");
  nodes.uiStatus.classList.toggle("is-success", tone === "success");
}

function setTransientUiNotice(message, tone = "neutral", delayMs = 3200) {
  transientUiNotice = { message, tone };
  if (transientUiNoticeTimer) {
    window.clearTimeout(transientUiNoticeTimer);
  }
  transientUiNoticeTimer = window.setTimeout(() => {
    transientUiNoticeTimer = null;
    transientUiNotice = null;
    render();
  }, delayMs);
}

function uiBusyNotice() {
  const pending = currentLiveState?.pendingInteraction || actionHandoffState || null;

  if (uiState.booting) {
    return { message: "Connecting to selected thread...", tone: "busy" };
  }

  if (uiState.selecting) {
    return { message: selectionIntentMessage(selectionIntent, "Switching shared room..."), tone: "busy" };
  }

  if (uiState.refreshing) {
    return { message: "", tone: "neutral" };
  }

  if (uiState.openingDesktop) {
    return { message: "Opening thread in Codex...", tone: "busy" };
  }

  if (uiState.submittingAction) {
    return { message: interactionBusyNotice(pending, uiState.submittingAction), tone: "busy" };
  }

  if (uiState.controlling) {
    return { message: "Releasing remote control...", tone: "busy" };
  }

  if (companionActionState) {
    return { message: "Updating advisory reminder...", tone: "busy" };
  }

  if (uiState.loadingChanges && currentChanges == null) {
    return { message: "Loading files and diffs...", tone: "busy" };
  }

  return { message: "", tone: "neutral" };
}

function interactionBusyNotice(pending, action) {
  const subject = interactionSubject(pending);

  switch (action) {
    case "approve":
      return pending?.kind === "permissions" ? `Allowing ${subject}...` : `Approving ${subject}...`;
    case "session":
      return pending?.kind === "permissions" ? `Allowing ${subject} for session...` : `Approving ${subject} for session...`;
    case "decline":
      return `Declining ${subject}...`;
    case "cancel":
      return `Cancelling ${subject}...`;
    case "submit":
    default:
      return `Submitting ${subject}...`;
  }
}

function interactionSubject(pending) {
  const raw = String(pending?.summary || pending?.kindLabel || pending?.kind || "request").trim();
  const normalized = raw.replace(/\s+approval$/i, "").trim();
  return normalized || "request";
}

function interactionActionSummary(pending, action = "approve") {
  const subject = interactionSubject(pending);

  switch (action) {
    case "decline":
      return `Declined ${subject}.`;
    case "cancel":
      return pending?.actionKind === "user_input" ? `Cancelled ${subject}.` : `Declined ${subject}.`;
    case "session":
      return pending?.kind === "permissions" ? `Allowed ${subject} for session.` : `Approved ${subject} for session.`;
    case "submit":
      return `Submitted ${subject}.`;
    case "approve":
    default:
      return pending?.kind === "permissions" ? `Allowed ${subject}.` : `Approved ${subject}.`;
  }
}

function clearActionHandoff({ renderNow = true } = {}) {
  if (actionHandoffTimer) {
    window.clearTimeout(actionHandoffTimer);
    actionHandoffTimer = null;
  }

  if (!actionHandoffState) {
    return;
  }

  actionHandoffState = null;
  if (renderNow) {
    render();
  }
}

function beginActionHandoff(previousPending, nextState = currentLiveState, action = "approve") {
  clearActionHandoff({ renderNow: false });

  if (!previousPending) {
    return;
  }

  const liveThread = nextState?.selectedThreadSnapshot?.thread || null;
  const busy = nextState?.status?.writeLock?.status || liveThread?.activeTurnId;
  if (!busy) {
    return;
  }

  actionHandoffState = {
    actionKind: "handoff",
    detail: `${interactionActionSummary(previousPending, action)} ${
      previousPending.flowStep > 1 ? "Waiting for the next request in this turn..." : "Waiting for Codex to continue..."
    }`.trim(),
    flowContinuation: previousPending.summary ? `Last request: ${previousPending.summary}.` : previousPending.flowContinuation || "",
    flowLabel: previousPending.flowLabel || "",
    handoff: true,
    kindLabel: "Waiting",
    title: previousPending.actionKind === "user_input" ? "Input received" : "Decision received"
  };

  actionHandoffTimer = window.setTimeout(() => {
    actionHandoffTimer = null;
    actionHandoffState = null;
    render();
  }, 1800);
}

function resetCardHistoryIfNeeded() {
  const threadId = currentLiveState?.selectedThreadSnapshot?.thread?.id || null;
  if (threadId === renderedThreadId) {
    return;
  }

  renderedThreadId = threadId;
  seenCardKeys.clear();
  seenCommandKeys.clear();
  expandedEntryKeys.clear();
  expandedFeedSections.clear();
  for (const key of surfaceViewState.loadExpandedSections(threadId || "none")) {
    expandedFeedSections.add(key);
  }
  hasRenderedOnce = false;
}

function isNewFeedCard(entry) {
  const key = entryKey(entry);
  if (!hasRenderedOnce) {
    seenCardKeys.add(key);
    return false;
  }

  if (seenCardKeys.has(key)) {
    return false;
  }

  seenCardKeys.add(key);
  return true;
}

function commandEntryKey(entry) {
  return [entry.id || "", entry.type || "", entry.timestamp || "", entry.summary || ""].join("|");
}

function isNewCommandCard(entry) {
  const key = commandEntryKey(entry);
  if (!hasRenderedOnce) {
    seenCommandKeys.add(key);
    return false;
  }

  if (seenCommandKeys.has(key)) {
    return false;
  }

  seenCommandKeys.add(key);
  return true;
}

function buildEntries() {
  const transcript = currentSurfaceTranscript({
    bootstrapSnapshot: currentSnapshot,
    liveState: currentLiveState
  });
  const companionWakeups = currentLiveState?.selectedCompanion?.wakeups || [];
  return [...companionWakeups, ...transcript]
    .filter((entry) => !shouldHideTranscriptEntry(entry))
    .slice()
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
}

function currentAgentRoom() {
  return currentLiveState?.selectedAgentRoom || {
    enabled: false,
    memberIds: [],
    messages: [],
    participants: [],
    round: null,
    threadId: currentThreadId() || null,
    updatedAt: null
  };
}

function councilEntries() {
  return currentAgentRoom().messages || [];
}

function councilSummaryText() {
  const roomState = currentAgentRoom();
  if (!roomState.enabled) {
    return "off";
  }

  if (roomState.round?.status === "running") {
    const pendingCount = Number(roomState.round.pendingCount || roomState.round.pendingParticipantIds?.length || 0);
    return pendingCount > 0 ? `${pendingCount} thinking` : "running";
  }

  if (roomState.round?.status === "partial") {
    const completedCount = Number(roomState.round.completedCount || roomState.round.completedParticipantIds?.length || 0);
    const failedCount = Number(roomState.round.failedCount || roomState.round.failedParticipantIds?.length || 0);
    return `${completedCount} replied / ${failedCount} failed`;
  }

  if (roomState.round?.status === "complete") {
    const completedCount = Number(roomState.round.completedCount || roomState.round.completedParticipantIds?.length || 0);
    return completedCount > 0 ? `${completedCount} replied` : "complete";
  }

  const messageCount = Array.isArray(roomState.messages) ? roomState.messages.length : 0;
  return messageCount === 1 ? "1 message" : `${messageCount} messages`;
}

function renderFilterButtons(entries) {
  for (const button of nodes.filterButtons) {
    const filter = button.dataset.filter;
    button.classList.toggle("is-active", feedFilters[filter]);
    button.textContent = humanize(filter);
  }
}

function describeControlEvent(event) {
  if (!event?.action) {
    return "";
  }

  const actorLabel = describeSurfaceActor(event.actor, event.actorClientId, { localSurface: "host" });

  if (event.action === "claim") {
    return event.actor === "remote" ? `${actorLabel} control active.` : `${actorLabel} claimed control.`;
  }

  if (event.action === "release") {
    if (event.cause === "expired") {
      return "Remote control expired.";
    }

    return `${actorLabel} released control.`;
  }

  return "";
}

function shortSurfaceClientLabel(clientId = "") {
  const normalized = String(clientId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!normalized) {
    return "";
  }

  return normalized.length > 4 ? normalized.slice(-4) : normalized;
}

function describeSurfaceActor(surface, clientId, { localSurface = "" } = {}) {
  const base = surface === "host" ? "Host" : "Remote";
  if (surface === localSurface && clientId === surfaceAuthClientId) {
    return surface === "host" ? "This host" : "This remote";
  }

  const suffix = shortSurfaceClientLabel(clientId);
  return suffix ? `${base} ${suffix}` : base;
}

function controlOwnerLabel(lease) {
  if (!lease) {
    return "";
  }

  return describeSurfaceActor(lease.source || lease.owner || "remote", lease.ownerClientId || null, {
    localSurface: "host"
  });
}

function renderSelectors() {
  const threads = currentLiveState?.threads || [];
  const groups = groupThreadsByProject(threads);
  const selectedProject = currentLiveState?.selectedProjectCwd || "";
  const selectedThread = currentLiveState?.selectedThreadId || "";

  if (groups.length === 0) {
    populateSelect(nodes.hostProjectSelect, [{ value: "", label: "No projects" }], "");
    populateSelect(nodes.hostSessionSelect, [{ value: "", label: "No sessions" }], "");
    nodes.hostProjectSelect.disabled = true;
    nodes.hostSessionSelect.disabled = true;
    return;
  }

  populateSelect(
    nodes.hostProjectSelect,
    groups.map((group) => ({ value: group.cwd, label: group.label })),
    selectedProject
  );
  nodes.hostProjectSelect.disabled = uiState.selecting || uiState.refreshing || uiState.booting;

  const currentGroup = groups.find((group) => group.cwd === selectedProject) || groups[0];
  const selectedInGroup = currentGroup.threads.some((thread) => thread.id === selectedThread)
    ? selectedThread
    : currentGroup.threads[0]?.id || "";

  populateSelect(
    nodes.hostSessionSelect,
    currentGroup.threads.map((thread) => ({ value: thread.id, label: sessionLabel(thread) })),
    selectedInGroup
  );
  nodes.hostSessionSelect.disabled = uiState.selecting || uiState.refreshing || uiState.booting;
}

function renderStatuses() {
  const status = currentLiveState?.status || {};
  const liveThread = currentLiveState?.selectedThreadSnapshot?.thread || null;
  const selectedChannel = currentLiveState?.selectedChannel || currentLiveState?.selectedThreadSnapshot?.channel || null;
  const selectedAttachments = mergeSurfaceAttachments(currentLiveState?.selectedAttachments || [], localSurfaceAttachment());
  const participants = currentLiveState?.participants || currentLiveState?.selectedThreadSnapshot?.participants || [];
  const transcriptHydrating = Boolean(currentLiveState?.selectedThreadSnapshot?.transcriptHydrating);
  const remoteControlActive = Boolean(
    status.controlLeaseForSelection &&
      (status.controlLeaseForSelection.owner === "remote" || status.controlLeaseForSelection.source === "remote")
  );
  const operatorDiagnostics = describeOperatorDiagnostics({
    diagnostics: status.diagnostics || [],
    ownsControl: false,
    status,
    surface: "host"
  });
  const threadState = describeThreadState({
    pendingInteraction: currentLiveState?.pendingInteraction,
    status,
    thread: liveThread
  });
  const controllerLabel = controlOwnerLabel(status.controlLeaseForSelection || null);

  const pendingTitle = uiState.selecting ? selectionIntentTitle(selectionIntent) : "";

  nodes.hostPath.textContent = selectedChannel?.serverLabel
    ? `dextunnel // ${selectedChannel.serverLabel}`
    : liveThread?.cwd
      ? `dextunnel // ${projectLabel(liveThread.cwd)}`
      : "dextunnel // host";
  nodes.sessionTitle.textContent = pendingTitle || selectedChannel?.channelSlug || liveThread?.name || currentSnapshot?.session?.title || "#loading";
  nodes.hostDesktopSyncNote.textContent = describeDesktopSyncNote({
    hasSelectedThread: Boolean(liveThread?.id),
    status
  });
  if (operatorDiagnostics.length > 0) {
    const diagnosticsHtml = operatorDiagnostics
      .slice(0, 2)
      .map((entry) => {
        const toneClass = entry.severity === "warn" ? "is-warn" : "is-info";
        const title = entry.detail ? `${entry.title} ${entry.detail}` : entry.title;
        return `<span class="diagnostic-chip ${toneClass}" title="${escapeHtml(title)}">${escapeHtml(entry.label)}</span>`;
      })
      .join("");
    setHtmlIfChanged(
      nodes.hostOperatorDiagnostics,
      diagnosticsHtml,
      `host-diagnostics:${operatorDiagnostics.map((entry) => `${entry.code}:${entry.label}`).join("|")}`
    );
    setPanelHidden(nodes.hostOperatorDiagnostics, false);
  } else {
    setHtmlIfChanged(nodes.hostOperatorDiagnostics, "", "host-diagnostics:empty");
    setPanelHidden(nodes.hostOperatorDiagnostics, true);
  }
  nodes.sessionSummary.textContent = liveThread?.id
    ? [
        "local admin surface",
        remoteControlActive && controllerLabel ? `${controllerLabel.toLowerCase()} controlling` : "remote idle",
        threadState !== "ready" ? threadState : "mirror ready"
      ]
        .filter(Boolean)
        .join(" // ")
    : "Local status and approvals for the selected room.";
  nodes.sessionTopic.textContent = "";
  setPanelHidden(nodes.sessionTopic, true);
  setHtmlIfChanged(nodes.sessionRoster, "", "participant-roster:host-hidden");
  setPanelHidden(nodes.sessionRoster, true);

  let bridgeStatusLine = "Starting session bridge...";
  const busyNotice = uiBusyNotice();

  if (bridgeState.streamState !== "live") {
    bridgeStatusLine = currentLiveState ? "Reconnecting session bridge..." : "Connecting to session bridge...";
  } else if (transcriptHydrating) {
    bridgeStatusLine = "Loading more from the selected room...";
  } else if (status.watcherConnected) {
    const liveBits = [];
    if (remoteControlActive) {
      liveBits.push(controllerLabel ? `${controllerLabel} control active` : "Remote control active");
    }
    if (threadState !== "ready") {
      liveBits.push(threadState);
    }
    bridgeStatusLine = liveBits.join(" // ") || "Session bridge online";
  } else if (status.lastError) {
    bridgeStatusLine = "Session bridge offline";
  }

  if (busyNotice.message) {
    bridgeStatusLine = busyNotice.message;
  } else if (transientUiNotice?.message) {
    bridgeStatusLine = transientUiNotice.message;
  }

  marqueeTicker.setText(bridgeStatusLine);
  if (transientUiNotice?.message) {
    setUiStatus(transientUiNotice.message, transientUiNotice.tone);
  } else {
    setUiStatus("", "neutral");
  }
  setPanelHidden(nodes.hostControlIndicator, !remoteControlActive);
  nodes.hostControlIndicator.textContent = remoteControlActive
    ? controllerLabel
      ? `${controllerLabel} control active`
      : "Remote control active"
    : "";
  nodes.hostRefreshButton.disabled =
    uiState.refreshing ||
    uiState.selecting ||
    uiState.booting;
  nodes.hostRefreshButton.textContent = uiState.refreshing ? "Refreshing..." : "Refresh";
  nodes.hostRefreshButton.classList.toggle("is-busy", uiState.refreshing);
  nodes.hostOpenInCodexButton.disabled =
    !liveThread?.id ||
    uiState.openingDesktop ||
    uiState.selecting ||
    uiState.booting;
  nodes.hostOpenInCodexButton.textContent = uiState.openingDesktop ? "Revealing..." : "Reveal in Codex";
  nodes.hostOpenInCodexButton.title = "Reveal this thread in the Codex app. Quit and reopen the app manually to see new messages generated here.";
  nodes.hostOpenInCodexButton.classList.toggle("is-busy", uiState.openingDesktop);
  setPanelHidden(nodes.hostReleaseControlButton, !remoteControlActive);
  nodes.hostReleaseControlButton.disabled = !remoteControlActive || uiState.refreshing || uiState.selecting || uiState.booting || uiState.controlling;
  nodes.hostReleaseControlButton.textContent = uiState.controlling ? "Releasing..." : "Release remote";
  nodes.hostReleaseControlButton.classList.toggle("is-busy", uiState.controlling);
  setPanelHidden(nodes.hostDebugPanel, !status.devToolsEnabled);
}

function formatActionDetail(pending) {
  const parts = [];

  if (pending.flowLabel || pending.flowContinuation) {
    parts.push(`
      <div class="interaction-flow">
        ${pending.flowLabel ? `<p class="interaction-flow-label">${escapeHtml(pending.flowLabel)}</p>` : ""}
        ${pending.flowContinuation ? `<p class="interaction-flow-copy">${escapeHtml(pending.flowContinuation)}</p>` : ""}
      </div>
    `);
  }

  if (pending.summary) {
    parts.push(`<p class="question-help">Now: ${escapeHtml(pending.summary)}</p>`);
  }

  if (pending.detail) {
    parts.push(`<p>${escapeHtml(pending.detail)}</p>`);
  }

  if (pending.command) {
    parts.push(`<pre class="command-preview">${escapeHtml(pending.command)}</pre>`);
  }

  if (pending.cwd) {
    parts.push(`<p class="question-help">${escapeHtml(pending.cwd)}</p>`);
  }

  if (pending.permissions) {
    parts.push(`<pre class="command-preview">${escapeHtml(JSON.stringify(pending.permissions, null, 2))}</pre>`);
  }

  return parts.join("");
}

function renderQuestions(questions, requestId = "") {
  const html = questions
    .map((question) => {
      const options = question.options || [];
      const baseControl = options.length
        ? `
            <select data-answer-id="${escapeHtml(question.id)}">
              <option value="">Select</option>
              ${options
                .map((option) => `<option value="${escapeHtml(option.label)}">${escapeHtml(option.label)}</option>`)
                .join("")}
              ${question.isOther ? '<option value="__other__">Other</option>' : ""}
            </select>
          `
        : `
            <input
              type="${question.isSecret ? "password" : "text"}"
              data-answer-id="${escapeHtml(question.id)}"
              placeholder="${escapeHtml(question.header || question.question)}"
            >
          `;

      const otherControl = question.isOther
        ? `
            <input
              type="${question.isSecret ? "password" : "text"}"
              data-answer-other="${escapeHtml(question.id)}"
              placeholder="Other"
            >
          `
        : "";

      return `
        <label class="question-field">
          <span>${escapeHtml(question.header || question.id)}</span>
          <span class="question-help">${escapeHtml(question.question)}</span>
          ${baseControl}
          ${otherControl}
        </label>
      `;
    })
    .join("");
  const signature = JSON.stringify(
    (questions || []).map((question) => ({
      header: question.header,
      id: question.id,
      isOther: Boolean(question.isOther),
      isSecret: Boolean(question.isSecret),
      options: (question.options || []).map((option) => option.label),
      question: question.question
    }))
  );
  setHtmlIfChanged(nodes.actionQuestions, html, `questions:${requestId}:${signature}`);
}

function renderActionPanel() {
  const pending = currentLiveState?.pendingInteraction || actionHandoffState || null;

  if (!pending) {
    setPanelHidden(nodes.actionPanel, true);
    nodes.actionPanel.classList.remove("panel-pop");
    setPanelHidden(nodes.actionForm, true);
    setPanelHidden(nodes.actionButtons, false);
    setPanelHidden(nodes.approveSessionButton, true);
    clearHtmlRenderState(nodes.actionQuestions);
    return;
  }

  setPanelHidden(nodes.actionPanel, false);
  nodes.actionPanel.classList.add("panel-pop");
  nodes.actionTitle.textContent = pending.title || "Action required";
  nodes.actionKind.textContent = pending.kindLabel || (pending.actionKind === "user_input" ? "Input" : pending.handoff ? "Waiting" : "Approval");
  nodes.actionCard.innerHTML = formatActionDetail(pending);

  if (pending.handoff) {
    setPanelHidden(nodes.actionForm, true);
    setPanelHidden(nodes.actionButtons, true);
    setPanelHidden(nodes.approveSessionButton, true);
    clearHtmlRenderState(nodes.actionQuestions);
    return;
  }

  const isUserInput = pending.actionKind === "user_input";
  setPanelHidden(nodes.actionForm, !isUserInput);
  setPanelHidden(nodes.actionButtons, isUserInput);

  if (isUserInput) {
    renderQuestions(pending.questions || [], pending.requestId || "pending");
    nodes.actionSubmit.textContent = uiState.submittingAction === "submit" ? "Submitting..." : pending.submitLabel || "Submit";
    nodes.actionCancel.textContent = uiState.submittingAction === "cancel" ? "Cancelling..." : "Cancel";
  } else {
    clearHtmlRenderState(nodes.actionQuestions);
    nodes.approveButton.textContent =
      uiState.submittingAction === "approve"
        ? pending.kind === "permissions"
          ? "Allowing..."
          : "Approving..."
        : pending.approveLabel || (pending.kind === "permissions" ? "Allow turn" : "Approve");
    nodes.declineButton.textContent = uiState.submittingAction === "decline" ? "Declining..." : pending.declineLabel || "Decline";
    nodes.approveSessionButton.textContent =
      uiState.submittingAction === "session"
        ? pending.kind === "permissions"
          ? "Allowing..."
          : "Approving..."
        : pending.sessionActionLabel || "Approve for session";
    setPanelHidden(nodes.approveSessionButton, !pending.canApproveForSession);
  }

  nodes.actionSubmit.disabled = uiState.submittingAction;
  nodes.actionCancel.disabled = uiState.submittingAction;
  nodes.approveButton.disabled = uiState.submittingAction;
  nodes.approveSessionButton.disabled = uiState.submittingAction;
  nodes.declineButton.disabled = uiState.submittingAction;
  nodes.actionSubmit.classList.toggle("is-busy", uiState.submittingAction && isUserInput);
  nodes.approveButton.classList.toggle("is-busy", uiState.submittingAction && !isUserInput);
  nodes.approveSessionButton.classList.toggle("is-busy", uiState.submittingAction && !isUserInput);
  nodes.declineButton.classList.toggle("is-busy", uiState.submittingAction && !isUserInput);
}

function renderFeed() {
  resetCardHistoryIfNeeded();
  const entries = buildEntries();
  renderFilterButtons(entries);
  const changesSection = feedFilters.changes ? renderChangesSection() : null;
  const items = [];
  const roomEntries = councilEntries();
  const threadEntries = entries.filter((entry) => isConversationEntry(entry) && !isAdvisoryEntry(entry));
  const advisoryEntries = entries.filter((entry) => isAdvisoryEntry(entry));
  const toolEntries = entries.filter((entry) => entry.role === "tool");
  const updateEntries = entries.filter(
    (entry) =>
      !isSystemNoticeEntry(entry) &&
      !isConversationEntry(entry) &&
      !isAdvisoryEntry(entry) &&
      entry.role !== "tool"
  );

  if (changesSection) {
    items.push({
      html: changesSection.html,
      key: "__changes__",
      signature: changesSection.signature
    });
  }

  if (feedFilters.thread) {
    items.push(...renderFeedItems(threadEntries));
  }

  if (feedFilters.council) {
    const section = renderSupplementalSection("council", {
      entries: roomEntries,
      kicker: "Council",
      summary: councilSummaryText(),
      title: "Optional advisory room"
    });
    if (section) {
      items.push(section);
    }
  }

  if (feedFilters.advisories) {
    const section = renderSupplementalSection("advisories", {
      entries: advisoryEntries,
      kicker: "Advisories",
      summary: advisoryEntries.length === 1 ? "1 item" : `${advisoryEntries.length} items`,
      title: "Recaps and reviews"
    });
    if (section) {
      items.push(section);
    }
  }

  if (feedFilters.updates) {
    const section = renderSupplementalSection("updates", {
      entries: updateEntries,
      kicker: "Updates",
      summary: updateEntries.length === 1 ? "1 item" : `${updateEntries.length} items`,
      title: "Operational notes"
    });
    if (section) {
      items.push(section);
    }
  }

  if (feedFilters.tools) {
    const section = renderSupplementalSection("tools", {
      entries: toolEntries,
      kicker: "Tools",
      summary: toolEntries.length === 1 ? "1 item" : `${toolEntries.length} items`,
      title: "Tool output"
    });
    if (section) {
      items.push(section);
    }
  }

  if (!items.length) {
    items.push({
      html: '<div class="empty-card">No matching items.</div>',
      key: "__empty__",
      signature: "empty"
    });
  }

  reconcileRenderedList(nodes.feed, items);

  hasRenderedOnce = true;
}

function summarizeInteraction(entry) {
  if (!entry) {
    return "";
  }

  const requestLabel = String(entry.summary || humanize(entry.kind || "interaction") || "interaction").trim();
  const progressionSuffix = entry.flowStep > 1 ? ` (step ${entry.flowStep})` : "";
  if (entry.status === "pending") {
    return `Waiting on ${requestLabel}${progressionSuffix}.`;
  }

  if (entry.status === "responded") {
    if (entry.action === "decline" || entry.action === "cancel") {
      return `Sent ${entry.action} for ${requestLabel}${progressionSuffix}.`;
    }

    if (entry.action === "session") {
      return `Allowed ${requestLabel}${progressionSuffix} for the session.`;
    }

    if (entry.action === "submit") {
      return `Submitted ${requestLabel}${progressionSuffix}.`;
    }

    return `Approved ${requestLabel}${progressionSuffix}.`;
  }

  if (entry.status === "cleared") {
    return `${requestLabel} cleared${progressionSuffix}.`;
  }

  if (entry.status === "resolved") {
    return `${requestLabel} settled${progressionSuffix}.`;
  }

  if (entry.action === "decline") {
    return `Declined ${requestLabel}${progressionSuffix}.`;
  }

  if (entry.action === "session") {
    return `Allowed ${requestLabel}${progressionSuffix} for the current session.`;
  }

  if (entry.action === "submit") {
    return `Submitted ${requestLabel}${progressionSuffix}.`;
  }

  return `Approved ${requestLabel}${progressionSuffix}.`;
}

function buildLiveInteractionLogEntry() {
  const interaction = currentLiveState?.status?.lastInteractionForSelection || null;
  if (!interaction) {
    return null;
  }

  return {
    id: `live-interaction-${interaction.kind || "interaction"}-${interaction.at || "unknown"}-${interaction.action || interaction.status || "event"}`,
    source: interaction.source || "app-server",
    summary: summarizeInteraction(interaction),
    timestamp: interaction.at || null,
    type: interaction.kind || "interaction"
  };
}

function renderCommandLog() {
  const commandLog = currentSnapshot?.commandLog?.slice().reverse() || [];
  const liveInteraction = buildLiveInteractionLogEntry();
  const entries = liveInteraction ? [liveInteraction, ...commandLog] : commandLog;

  const html = entries.length
    ? entries
        .map((entry) => {
          const classes = ["command-card"];
          if (isNewCommandCard(entry)) {
            classes.push("card-new");
          }

          return `
            <article class="${classes.join(" ")}">
              <div class="card-head">
                <span class="card-label">${escapeHtml(humanize(entry.type))}</span>
                ${entry.timestamp ? `<time class="card-time">${escapeHtml(new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</time>` : ""}
              </div>
              <div class="card-note">${escapeHtml(entry.source || "mock-adapter")}</div>
              <p>${escapeHtml(entry.summary || "")}</p>
            </article>
          `;
        })
        .join("")
    : '<div class="empty-card">No log events.</div>';
  const signature = JSON.stringify(entries.map((entry) => commandEntryKey(entry)));
  setHtmlIfChanged(nodes.commandLog, html, `command-log:${signature}`);
}

function changesSummaryText() {
  if (currentChanges == null) {
    return uiState.loadingChanges ? "Loading changes..." : "No repo diff";
  }

  if (!currentChanges.supported) {
    return "No repo diff";
  }

  const count = currentChanges.shownCount || currentChanges.items?.length || currentChanges.totalCount || 0;
  const hiddenLabel = currentChanges.hiddenCount ? ` // +${currentChanges.hiddenCount} more` : "";
  const sourceLabel =
    currentChanges.source === "live_turn"
      ? " // live turn"
      : currentChanges.source === "git_session"
        ? " // session focus"
        : "";
  const focusLabel = currentChanges.focusPaths?.length
    ? ` // focus ${shortPathLabel(currentChanges.focusPaths[0])}${currentChanges.focusPaths.length > 1 ? ` +${currentChanges.focusPaths.length - 1}` : ""}`
    : "";

  return `${count === 1 ? "1 file" : `${count} files`}${hiddenLabel}${sourceLabel}${focusLabel}${uiState.loadingChanges ? " // syncing" : ""}`;
}

function currentThreadIdLabel() {
  return currentLiveState?.selectedThreadId || "";
}

function feedSectionKey(name) {
  return `${name}:${currentThreadIdLabel() || "none"}`;
}

function changesSectionKey() {
  return feedSectionKey("changes");
}

function renderChangesSection() {
  const summary = changesSummaryText();
  const open = expandedFeedSections.has(changesSectionKey());

  if (currentChanges == null) {
    return {
      html: `
        <details class="feed-section feed-section-changes feed-section-details" data-feed-section="changes"${open ? " open" : ""}>
          <summary class="feed-section-summary">
            <div>
              <p class="feed-section-kicker">Changes</p>
              <h3>Files and diffs</h3>
            </div>
            <span class="inline-status ${uiState.loadingChanges ? "is-busy" : ""}">${escapeHtml(summary)}</span>
          </summary>
          <div class="changes-list">
            <div class="empty-card">Loading changes for the selected session...</div>
          </div>
        </details>
      `,
      signature: `changes:loading:${open ? "open" : "closed"}`
    };
  }

  if (!currentChanges.supported) {
    return {
      html: `
        <details class="feed-section feed-section-changes feed-section-details" data-feed-section="changes"${open ? " open" : ""}>
          <summary class="feed-section-summary">
            <div>
              <p class="feed-section-kicker">Changes</p>
              <h3>Files and diffs</h3>
            </div>
            <span class="inline-status">${escapeHtml(summary)}</span>
          </summary>
          <div class="changes-list">
            <div class="empty-card">No Git diff available for this project.</div>
          </div>
        </details>
      `,
      signature: `changes:unsupported:${open ? "open" : "closed"}`
    };
  }

  const count = currentChanges.shownCount || currentChanges.items?.length || currentChanges.totalCount || 0;
  const html = count
    ? currentChanges.items
        .map((change, index) => renderChangeCard(change, { open: index === 0 && count <= 3 }))
        .join("")
    : `<div class="empty-card">${currentChanges.source === "live_turn" ? "No live diff yet." : "Working tree is clean."}</div>`;
  const signature = JSON.stringify({
    count,
    cwd: currentChanges.cwd || "",
    source: currentChanges.source || "",
    focusPaths: currentChanges.focusPaths || [],
    hiddenCount: currentChanges.hiddenCount || 0,
    items: (currentChanges.items || []).map((change) => ({
      additions: change.additions,
      deletions: change.deletions,
      diffPreview: change.diffPreview,
      fromPath: change.fromPath,
      kind: change.kind,
      path: change.path,
      relevance: change.relevance,
      statusCode: change.statusCode
    }))
  });

  return {
    html: `
      <details class="feed-section feed-section-changes feed-section-details" data-feed-section="changes"${open ? " open" : ""}>
        <summary class="feed-section-summary">
          <div>
            <p class="feed-section-kicker">Changes</p>
            <h3>Files and diffs</h3>
          </div>
          <span class="inline-status ${uiState.loadingChanges ? "is-busy" : ""}">${escapeHtml(summary)}</span>
        </summary>
        <div class="changes-list">${html}</div>
      </details>
    `,
    signature: `changes:${open ? "open" : "closed"}:${signature}`
  };
}

function renderFeedItems(entries) {
  return entries.map((entry) => {
    const isNew = isNewFeedCard(entry);
    const isExpanded = expandedEntryKeys.has(entryKey(entry));
    const nextEntry =
      companionActionState?.key && entry.key === companionActionState.key
        ? {
            ...entry,
            actionState: {
              action: companionActionState.action,
              busy: true
            }
          }
        : entry;
    return {
      html: renderTranscriptCard(nextEntry, { expanded: isExpanded, isNew }),
      key: entryKey(entry),
      signature: JSON.stringify({
        actionState: nextEntry.actionState || null,
        expanded: isExpanded,
        entry: nextEntry
      })
    };
  });
}

function renderSupplementalSection(name, { kicker, title, entries, summary }) {
  if (!entries.length) {
    return null;
  }

  const open = expandedFeedSections.has(feedSectionKey(name));
  const items = renderFeedItems(entries);
  return {
    html: `
      <details class="feed-section feed-section-details" data-feed-section="${escapeHtml(name)}"${open ? " open" : ""}>
        <summary class="feed-section-summary">
          <div>
            <p class="feed-section-kicker">${escapeHtml(kicker)}</p>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <span class="inline-status">${escapeHtml(summary)}</span>
        </summary>
        <div class="feed-list">${items.map((item) => item.html).join("")}</div>
      </details>
    `,
    key: `__section__:${name}`,
    signature: JSON.stringify({
      items: items.map((item) => item.signature),
      name,
      open
    })
  };
}

function shouldImmediatelyRefreshChanges(previousState, nextState) {
  if (!previousState) {
    return true;
  }

  if ((previousState.selectedThreadId || "") !== (nextState?.selectedThreadId || "")) {
    return true;
  }

  if ((previousState.turnDiff?.updatedAt || "") !== (nextState?.turnDiff?.updatedAt || "")) {
    return true;
  }

  if (
    (previousState.status?.lastWriteForSelection?.at || "") !==
    (nextState?.status?.lastWriteForSelection?.at || "")
  ) {
    return true;
  }

  if ((previousState.pendingInteraction?.requestId || "") !== (nextState?.pendingInteraction?.requestId || "")) {
    return true;
  }

  if (
    (previousState.selectedThreadSnapshot?.thread?.activeTurnId || "") !==
    (nextState?.selectedThreadSnapshot?.thread?.activeTurnId || "")
  ) {
    return true;
  }

  return false;
}

function render() {
  if (!currentSnapshot && !currentLiveState) {
    return;
  }

  renderSelectors();
  renderStatuses();
  renderActionPanel();
  renderFeed();
  renderCommandLog();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, withSurfaceHeaders(options, surfaceBootstrap.accessToken));
  const payload = await response.json();

  if (!response.ok) {
    throw createRequestError(payload, response);
  }

  return payload;
}

function adoptErrorState(error) {
  const state = error?.state || error?.payload?.state || null;
  if (!state) {
    return false;
  }

  currentLiveState = state;
  settleSelectionIntent();
  markLiveActivity();
  return true;
}

const bridgeLifecycle = createLiveBridgeLifecycle({
  bootstrapRetry: { baseMs: BOOTSTRAP_RETRY_BASE_MS, maxMs: BOOTSTRAP_RETRY_MAX_MS },
  createEventSource: (url) => new EventSource(withSurfaceTokenUrl(url, surfaceBootstrap.accessToken)),
  getHasLiveState: () => Boolean(currentLiveState),
  getVisible: () => document.visibilityState === "visible",
  onBootstrapError: ({ error, retrying }) => {
    if (!currentLiveState) {
      uiState.booting = true;
      nodes.sessionSummary.textContent = retrying ? "Waiting for session bridge..." : error.message;
      setUiStatus(retrying ? "Waiting for session bridge..." : error.message, retrying ? "busy" : "error");
    }
  },
  onBootstrapStart: () => {
    if (!currentLiveState) {
      uiState.booting = true;
    }
  },
  onBootstrapSuccess: ({ snapshot, live }) => {
    currentSnapshot = snapshot;
    currentLiveState = live;
    settleSelectionIntent();
    clearActionHandoff({ renderNow: false });
    uiState.booting = false;
    markLiveActivity();
    scheduleChangesRefresh({ immediate: true, showLoading: true });
    schedulePresenceSync(20, { force: true });
  },
  onLive: (live) => {
    const previousState = currentLiveState;
    currentLiveState = live;
    settleSelectionIntent();
    if (currentLiveState?.pendingInteraction || !currentLiveState?.selectedThreadSnapshot?.thread?.activeTurnId) {
      clearActionHandoff({ renderNow: false });
    }
    markLiveActivity();
    scheduleChangesRefresh({ immediate: shouldImmediatelyRefreshChanges(previousState, currentLiveState) });
    schedulePresenceSync(90);
  },
  onRender: render,
  onSnapshot: (snapshot) => {
    currentSnapshot = snapshot;
    settleSelectionIntent();
    markLiveActivity();
  },
  onStreamOpen: () => {
    if (streamIssueStartedAt) {
      setTransientUiNotice(`Bridge recovered in ${formatRecoveryDuration(Date.now() - streamIssueStartedAt)}.`, "success", 2200);
      streamIssueStartedAt = 0;
    }
    markLiveActivity();
  },
  onStreamError: () => {
    if (!streamIssueStartedAt) {
      streamIssueStartedAt = Date.now();
    }
  },
  requestBootstrap: async () => {
    const [snapshot, live] = await Promise.all([
      requestJson(stateUrl),
      requestJson(liveStateUrl)
    ]);

    return { live, snapshot };
  },
  requestRefresh: async ({ background = false }) => {
    if (!background) {
      uiState.refreshing = true;
      render();
    }

    try {
      const url = background ? `${refreshUrl}?threads=0` : refreshUrl;
      const payload = await requestJson(url, { method: "POST" });
      currentLiveState = payload.state;
      settleSelectionIntent();
      markLiveActivity();
      scheduleChangesRefresh({ immediate: true, showLoading: !background });
      schedulePresenceSync(90, { force: true });
      return payload;
    } finally {
      if (!background) {
        uiState.refreshing = false;
        render();
      }
    }
  },
  state: bridgeState,
  streamRecovery: { baseMs: STREAM_RECOVERY_BASE_MS, maxMs: STREAM_RECOVERY_MAX_MS },
  streamUrl: "/api/stream"
});

function closeStream() {
  bridgeLifecycle.closeStream();
}

function ensureStream({ force = false } = {}) {
  bridgeLifecycle.ensureStream({ force });
}

async function bootstrapLiveState({ retrying = false } = {}) {
  return bridgeLifecycle.bootstrap({ retrying });
}

async function refreshLiveState({ background = false } = {}) {
  return bridgeLifecycle.refresh({ background });
}

async function submitHostControlRelease() {
  if (uiState.controlling) {
    return null;
  }

  const threadId = currentLiveState?.selectedThreadSnapshot?.thread?.id || currentLiveState?.selectedThreadId || "";
  if (!threadId) {
    throw new Error("No live session selected.");
  }

  uiState.controlling = true;
  render();

  try {
    const payload = await requestJson(controlUrl, {
      body: JSON.stringify({
        action: "release",
        clientId: surfaceAuthClientId,
        source: "host",
        threadId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    currentLiveState = payload.state;
    markLiveActivity();
    schedulePresenceSync(30, { force: true });
    render();
    return payload;
  } catch (error) {
    adoptErrorState(error);
    throw error;
  } finally {
    uiState.controlling = false;
    render();
  }
}

async function refreshChanges({ background = false, cwd = currentLiveState?.selectedProjectCwd || "", showLoading = false } = {}) {
  if (!cwd) {
    currentChanges = null;
    uiState.loadingChanges = false;
    render();
    return null;
  }

  if (changesRefreshPromise) {
    return changesRefreshPromise;
  }

  if (showLoading) {
    uiState.loadingChanges = true;
    render();
  }

  const threadId = currentLiveState?.selectedThreadId || "";
  const query = new URLSearchParams({ cwd });
  if (threadId) {
    query.set("threadId", threadId);
  }

  changesRefreshPromise = requestJson(`${changesUrl}?${query.toString()}`)
    .then((payload) => {
      currentChanges = payload;
      render();
      return payload;
    })
    .catch((error) => {
      if (background) {
        return null;
      }
      throw error;
    })
    .finally(() => {
      if (showLoading) {
        uiState.loadingChanges = false;
        render();
      }
      changesRefreshPromise = null;
    });

  return changesRefreshPromise;
}

function scheduleChangesRefresh({ immediate = false, showLoading = false } = {}) {
  if (changesRefreshTimer) {
    window.clearTimeout(changesRefreshTimer);
  }

  changesRefreshTimer = window.setTimeout(() => {
    changesRefreshTimer = null;
    void refreshChanges({ background: true, showLoading });
  }, immediate ? 0 : 350);
}

async function submitSelection(body) {
  const requestVersion = ++selectionRequestVersion;
  selectionIntent = createSelectionIntent({
    cwd: body.cwd || currentLiveState?.selectedProjectCwd || "",
    projectLabel: projectLabel(body.cwd || currentLiveState?.selectedProjectCwd || ""),
    source: body.source || "host",
    threadId: body.threadId || "",
    threadLabel: currentLiveState?.threads?.find((thread) => thread.id === body.threadId)?.name || ""
  });
  uiState.selecting = true;
  render();

  try {
    const payload = await requestJson(selectionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        clientId: surfaceAuthClientId
      })
    });
    if (requestVersion !== selectionRequestVersion) {
      return;
    }
    currentLiveState = payload.state;
    settleSelectionIntent();
    markLiveActivity();
    scheduleChangesRefresh({ immediate: true, showLoading: true });
    schedulePresenceSync(40, { force: true });
    render();
  } catch (error) {
    if (requestVersion === selectionRequestVersion) {
      adoptErrorState(error);
      selectionIntent = null;
      uiState.selecting = false;
      render();
    }
    throw error;
  } finally {
    if (requestVersion === selectionRequestVersion && !selectionIntent) {
      uiState.selecting = false;
      render();
    }
  }
}

async function openInCodex() {
  const threadId = currentThreadId();
  if (!threadId) {
    throw new Error("No thread selected.");
  }

  uiState.openingDesktop = true;
  render();

  try {
    const payload = await requestJson(openInCodexUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId })
    });
    setTransientUiNotice(payload.message || "Revealed in Codex.", "success", 5200);
    render();
    return payload;
  } catch (error) {
    adoptErrorState(error);
    throw error;
  } finally {
    uiState.openingDesktop = false;
    render();
  }
}

async function submitInteraction(body) {
  const previousPending = currentLiveState?.pendingInteraction || null;
  uiState.submittingAction = body?.action || "submit";
  render();

  try {
    const payload = await requestJson(interactionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    currentLiveState = payload.state;
    if (!currentLiveState?.pendingInteraction) {
      beginActionHandoff(previousPending, currentLiveState, body?.action || "submit");
    }
    markLiveActivity();
    scheduleChangesRefresh({ immediate: true });
    schedulePresenceSync(30, { force: true });
    render();
  } catch (error) {
    adoptErrorState(error);
    throw error;
  } finally {
    uiState.submittingAction = false;
    render();
  }
}

async function submitCompanionAction({ action, advisorId, wakeKey }) {
  if (!action || !wakeKey || companionActionState) {
    return;
  }

  companionActionState = {
    action,
    key: wakeKey
  };
  render();

  try {
    const payload = await requestJson(companionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        advisorId,
        threadId: currentThreadId(),
        wakeKey
      })
    });
    currentLiveState = payload.state;
    markLiveActivity();
    schedulePresenceSync(30, { force: true });
    setTransientUiNotice(payload.message || "Advisory reminder updated.", "success");
    render();
  } catch (error) {
    adoptErrorState(error);
    throw error;
  } finally {
    companionActionState = null;
    render();
  }
}

function collectAnswers(questions) {
  const answers = {};

  for (const question of questions || []) {
    const primary = nodes.actionQuestions.querySelector(`[data-answer-id="${question.id}"]`);
    const other = nodes.actionQuestions.querySelector(`[data-answer-other="${question.id}"]`);
    const otherValue = other?.value.trim();

    if (otherValue) {
      answers[question.id] = otherValue;
      continue;
    }

    const primaryValue = primary?.value?.trim();
    if (primaryValue && primaryValue !== "__other__") {
      answers[question.id] = primaryValue;
    }
  }

  return answers;
}

async function sendMockCommand(command) {
  await requestJson("/api/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
}

async function sendLiveDebugInteraction(body) {
  const payload = await requestJson(debugInteractionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  currentLiveState = payload.state;
  markLiveActivity();
  render();
}

nodes.hostProjectSelect.addEventListener("change", async () => {
  try {
    await submitSelection({
      clientId: surfaceAuthClientId,
      cwd: nodes.hostProjectSelect.value,
      source: "host"
    });
  } catch (error) {
    window.alert(error.message);
  }
});

nodes.hostSessionSelect.addEventListener("change", async () => {
  try {
    const selected = currentLiveState?.threads?.find((thread) => thread.id === nodes.hostSessionSelect.value) || null;
    await submitSelection({
      clientId: surfaceAuthClientId,
      cwd: selected?.cwd || currentLiveState?.selectedProjectCwd || "",
      source: "host",
      threadId: nodes.hostSessionSelect.value
    });
  } catch (error) {
    window.alert(error.message);
  }
});

for (const button of nodes.filterButtons) {
  button.addEventListener("click", () => {
    markUserIntent();
    schedulePresenceSync(120);
    const filter = button.dataset.filter;
    const activeCount = Object.values(feedFilters).filter(Boolean).length;

    if (feedFilters[filter] && activeCount === 1) {
      return;
    }

    feedFilters[filter] = !feedFilters[filter];
    surfaceViewState.saveFilters(feedFilters);
    render();
  });
}

nodes.feed.addEventListener(
  "toggle",
  (event) => {
    const details = event.target.closest?.("details[data-feed-section]");
    if (!details) {
      return;
    }

    const key = feedSectionKey(details.dataset.feedSection || "");
    if (details.open) {
      expandedFeedSections.add(key);
    } else {
      expandedFeedSections.delete(key);
    }
    surfaceViewState.saveExpandedSections(currentThreadId() || "none", [...expandedFeedSections]);
  },
  true
);

nodes.feed.addEventListener("click", async (event) => {
  markUserIntent();
  const actionButton = event.target.closest("[data-companion-action]");
  if (actionButton) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await submitCompanionAction({
        action: actionButton.dataset.companionAction,
        advisorId: actionButton.dataset.advisorId,
        wakeKey: actionButton.dataset.wakeKey
      });
    } catch (error) {
      window.alert(error.message);
    }
    return;
  }

  if (event.target.closest("a")) {
    return;
  }

  const card = event.target.closest("[data-entry-key]");
  if (!card || card.dataset.expandable !== "true") {
    return;
  }

  const key = card.dataset.entryKey;
  if (expandedEntryKeys.has(key)) {
    expandedEntryKeys.delete(key);
  } else {
    expandedEntryKeys.add(key);
  }
  render();
});

nodes.feed.addEventListener("keydown", (event) => {
  markUserIntent();
  if (event.target.closest("[data-companion-action]")) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const card = event.target.closest("[data-entry-key]");
  if (!card || card.dataset.expandable !== "true") {
    return;
  }

  event.preventDefault();
  card.click();
});

nodes.hostRefreshButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await refreshLiveState();
  } catch (error) {
    window.alert(error.message);
  }
});

nodes.hostOpenInCodexButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await openInCodex();
  } catch (error) {
    window.alert(error.message);
  }
});

nodes.hostReleaseControlButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await submitHostControlRelease();
  } catch (error) {
    window.alert(error.message);
  }
});

nodes.approveButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await submitInteraction({ action: "approve" });
  } catch (error) {
    window.alert(error.message);
  }
});

nodes.approveSessionButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await submitInteraction({ action: "session" });
  } catch (error) {
    window.alert(error.message);
  }
});

nodes.declineButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await submitInteraction({ action: "decline" });
  } catch (error) {
    window.alert(error.message);
  }
});

nodes.actionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  markUserIntent();
  const pending = currentLiveState?.pendingInteraction;
  if (!pending) {
    return;
  }

  try {
    await submitInteraction({
      action: "submit",
      answers: collectAnswers(pending.questions || [])
    });
  } catch (error) {
    window.alert(error.message);
  }
});

nodes.actionCancel.addEventListener("click", async () => {
  markUserIntent();
  try {
    await submitInteraction({ action: "cancel" });
  } catch (error) {
    window.alert(error.message);
  }
});

document.querySelectorAll("[data-type]").forEach((button) => {
  button.addEventListener("click", async () => {
    markUserIntent();
    try {
      await sendMockCommand({
        type: button.dataset.type,
        strategyId: button.dataset.strategyId,
        windowProfileId: button.dataset.windowProfileId,
        source: "host"
      });
    } catch (error) {
      window.alert(error.message);
    }
  });
});

document.querySelectorAll("[data-live-interaction-kind]").forEach((button) => {
  button.addEventListener("click", async () => {
    markUserIntent();
    try {
      await sendLiveDebugInteraction({
        kind: button.dataset.liveInteractionKind
      });
    } catch (error) {
      window.alert(error.message);
    }
  });
});

document.querySelectorAll("[data-live-interaction-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    markUserIntent();
    try {
      await sendLiveDebugInteraction({
        action: button.dataset.liveInteractionAction
      });
    } catch (error) {
      window.alert(error.message);
    }
  });
});

nodes.assistantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  markUserIntent();

  try {
    await sendMockCommand({
      type: "simulate_assistant_turn",
      text: nodes.assistantText.value,
      source: "host"
    });
    nodes.assistantText.value = "";
  } catch (error) {
    window.alert(error.message);
  }
});

window.setInterval(() => {
  if (document.visibilityState !== "visible") {
    return;
  }

  if (!currentLiveState) {
    return;
  }

  if (bridgeState.streamState !== "live") {
    return;
  }

  if (Date.now() - lastLiveActivityAt <= FALLBACK_REFRESH_STALE_MS) {
    return;
  }

  void refreshLiveState({ background: true });
}, FALLBACK_REFRESH_INTERVAL_MS);

window.setInterval(() => {
  if (!currentLiveState || bridgeState.streamState !== "live") {
    return;
  }

  void syncPresence();
}, PRESENCE_HEARTBEAT_INTERVAL_MS);

document.addEventListener(
  "pointerdown",
  () => {
    markUserIntent();
    schedulePresenceSync(120);
  },
  { passive: true }
);

document.addEventListener("keydown", () => {
  markUserIntent();
  schedulePresenceSync(120);
});

document.addEventListener("input", () => {
  markUserIntent();
  schedulePresenceSync(120);
});

document.addEventListener("visibilitychange", () => {
  schedulePresenceSync(40, { force: true });
  if (document.visibilityState === "visible") {
    bridgeLifecycle.resumeVisible();
  }
});

window.addEventListener("focus", () => {
  schedulePresenceSync(40, { force: true });
  bridgeLifecycle.resumeVisible();
});

window.addEventListener("blur", () => {
  schedulePresenceSync(40, { force: true });
});

window.addEventListener("pagehide", () => {
  sendDetachPresence();
  closeStream();
});

ensureStream();
void bootstrapLiveState();
