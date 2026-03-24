import {
  canSteerReply as canSteerReplyState,
  canQueueReply as canQueueReplyState,
  cloneReplyAttachments,
  composeBlockedReason as composeBlockedReasonState,
  controlClaimRequired,
  controlEventStatus as controlEventStatusState,
  controlBlockedReason as controlBlockedReasonState,
  controlReleaseFeedback as controlReleaseFeedbackState,
  createQueuedReply,
  defaultComposerStatus,
  queueSummary as queueSummaryState,
  scopedThreadStorageKey,
  sendBlockedReason as sendBlockedReasonState,
  sessionBlockedReason as sessionBlockedReasonState,
  shouldFlushQueuedReplies,
  threadBusy as threadBusyState
} from "./remote-operator-state.js";
import {
  createSelectionIntent,
  reconcileSelectionIntent,
  selectionIntentMessage,
  selectionIntentTitle
} from "./live-selection-intent.js";
import {
  composeDictationDraft,
  getSpeechRecognitionCtor,
  speechRecognitionErrorMessage
} from "./voice-dictation.js";
import {
  createLiveBridgeLifecycle,
  createLiveBridgeLifecycleState
} from "./live-bridge-lifecycle.js";
import { createSurfaceViewState } from "./surface-view-state.js";

import {
  createRequestError,
  currentSurfaceTranscript,
  describeOperatorDiagnostics,
  describeRemoteScopeNote,
  clearHtmlRenderState,
  compareEntryChronology,
  compareEntryChronologyDesc,
  describeThreadState,
  entryDedupKey,
  entryKey,
  escapeHtml,
  formatBusyMarqueeText,
  formatSessionTimestamp,
  formatRecoveryDuration,
  formatSurfaceAttachmentSummary,
  formatTimestamp,
  getSurfaceBootstrap,
  groupThreadsByProject,
  humanize,
  isConversationEntry,
  isSystemNoticeEntry,
  mergeSurfaceAttachments,
  projectLabel,
  reconcileRenderedList,
  renderChangeCard,
  isAdvisoryEntry,
  setHtmlIfChanged,
  setPanelHidden,
  renderTranscriptCard,
  shortThreadId,
  stableSurfaceClientId,
  threadDisplayTitle,
  shouldHideTranscriptEntry,
  startTicker,
  withSurfaceHeaders,
  withSurfaceTokenUrl
} from "./client-shared.js";

const liveStateUrl = "/api/codex-app-server/live-state";
const refreshUrl = "/api/codex-app-server/refresh";
const selectionUrl = "/api/codex-app-server/selection";
const controlUrl = "/api/codex-app-server/control";
const companionUrl = "/api/codex-app-server/companion";
const interactionUrl = "/api/codex-app-server/interaction";
const turnUrl = "/api/codex-app-server/turn";
const changesUrl = "/api/codex-app-server/changes";
const presenceUrl = "/api/codex-app-server/presence";
const transcriptHistoryUrl = "/api/codex-app-server/transcript-history";
const stateUrl = "/api/state";
const FALLBACK_REFRESH_INTERVAL_MS = 6000;
const FALLBACK_REFRESH_STALE_MS = 14000;
const CONTROL_RENEW_INTERVAL_MS = 30000;
const CONTROL_RENEW_ACTIVE_WINDOW_MS = 90000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 12000;
const STREAM_RECOVERY_BASE_MS = 700;
const STREAM_RECOVERY_MAX_MS = 5000;
const BOOTSTRAP_RETRY_BASE_MS = 900;
const BOOTSTRAP_RETRY_MAX_MS = 6000;
const ROOM_STATUS_SETTLE_MS = 300;
const TRANSCRIPT_HISTORY_PAGE_SIZE = 40;
const TRANSCRIPT_HISTORY_BOTTOM_THRESHOLD_PX = 220;
const TRANSCRIPT_HISTORY_RESUME_SCROLL_DELTA_PX = 28;
const FEED_STICKY_TOP_THRESHOLD_PX = 96;
const SIDEBAR_MOBILE_BREAKPOINT_PX = 1180;
const DRAFT_STORAGE_PREFIX = "dextunnel:draft:";
const QUEUE_STORAGE_PREFIX = "dextunnel:queue:";
const IOS_FOCUS_PLATFORM_REGEX = /iPad|iPhone|iPod/;
const IOS_VIEWPORT_MAX_SCALE_CONTENT =
  "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
const surfaceBootstrap = getSurfaceBootstrap("remote");
const surfaceAuthClientId = surfaceBootstrap.clientId;

let currentSnapshot = null;
let currentLiveState = null;
let renderedThreadId = null;
let hasRenderedOnce = false;
let isComposerOpen = false;
let isSendingReply = false;
let pendingOutgoingText = "";
let pendingOutgoingAttachments = [];
let pendingAttachments = [];
let activeDictation = null;
let dictationBaseText = "";
let dictationCommittedText = "";
let dictationError = "";
let dictationInterimText = "";
let isDictationPressActive = false;
let dictationPointerId = null;
let suppressNextDictationClick = false;
let composerStatus = "Ready";
let composerStatusTone = "neutral";
let isDictating = false;
let lastLiveActivityAt = 0;
let transientUiNotice = null;
let transientUiNoticeTimer = null;
let lastHandledControlEventId = null;
let companionActionState = null;
let manualAdvisorAction = "";
let stagedCompanionWakeKey = "";
let controlRenewPromise = null;
let presenceSyncPromise = null;
let presenceSyncTimer = null;
let lastPresenceSignature = "";
let lastPresenceSyncAt = 0;
let currentChanges = null;
let changesRefreshPromise = null;
let changesRefreshTimer = null;
let queueFlushTimer = null;
let queueFlushPromise = null;
let streamIssueStartedAt = 0;
let actionHandoffState = null;
let actionHandoffTimer = null;
let queuedReplySequence = 0;
const surfaceClientId = stableSurfaceClientId("remote");
const surfaceViewState = createSurfaceViewState({
  defaults: {
    sidebarMode: "expanded",
    filters: {
      changes: true,
      thread: true,
      updates: true,
      tools: true
    }
  },
  scopeId: surfaceClientId,
  surface: "remote"
});
const expandedFeedSections = new Set();
let lastUserIntentAt = Date.now();
let draftThreadId = null;
let selectionIntent = null;
let selectionRequestVersion = 0;
let roomStatusHoldThreadId = "";
let roomStatusHoldUntil = 0;
let pendingScrollToLatest = false;
let lastRenderedFeedTopKey = null;
let expandAllCards = false;
let sidebarExpanded =
  typeof globalThis !== "undefined" && globalThis.innerWidth <= SIDEBAR_MOBILE_BREAKPOINT_PX
    ? false
    : surfaceViewState.loadSidebarMode() !== "collapsed";
const expandedEntryKeys = new Set();
const seenCardKeys = new Set();
const queuedRepliesByThreadId = new Map();
const transcriptHistoryByThreadId = new Map();
const bridgeState = createLiveBridgeLifecycleState({
  bootstrapRetryBaseMs: BOOTSTRAP_RETRY_BASE_MS,
  streamRecoveryBaseMs: STREAM_RECOVERY_BASE_MS
});
const feedFilters = surfaceViewState.loadFilters();
const uiState = {
  booting: true,
  controlling: false,
  loadingChanges: false,
  refreshing: false,
  selecting: false,
  submittingAction: false
};

const nodes = {
  actionButtons: document.querySelector("#remote-action-buttons"),
  actionCancel: document.querySelector("#remote-action-cancel"),
  actionCard: document.querySelector("#remote-action-card"),
  actionControlButton: document.querySelector("#remote-action-control-button"),
  actionControlGate: document.querySelector("#remote-action-control-gate"),
  actionForm: document.querySelector("#remote-action-form"),
  actionKind: document.querySelector("#remote-action-kind"),
  actionPanel: document.querySelector("#remote-action-panel"),
  actionQuestions: document.querySelector("#remote-action-questions"),
  approveSessionButton: document.querySelector("#approve-session-button"),
  actionSubmit: document.querySelector("#remote-action-submit"),
  actionTitle: document.querySelector("#remote-action-title"),
  approveButton: document.querySelector("#approve-button"),
  attachmentList: document.querySelector("#attachment-list"),
  dictationButton: document.querySelector("#dictation-button"),
  dictationButtonLabel: document.querySelector("#dictation-button-label"),
  dictationButtonMeta: document.querySelector("#dictation-button-meta"),
  dictationIndicator: document.querySelector("#dictation-indicator"),
  dictationIndicatorText: document.querySelector("#dictation-indicator-text"),
  clearQueueButton: document.querySelector("#clear-queue-button"),
  composerCloseButton: document.querySelector("#composer-close-button"),
  composerForm: document.querySelector("#composer-form"),
  composerControlButton: document.querySelector("#composer-control-button"),
  composerQueueList: document.querySelector("#composer-queue-list"),
  composerQueueShell: document.querySelector("#composer-queue-shell"),
  composerScopeNote: document.querySelector("#composer-scope-note"),
  composerShell: document.querySelector("#composer-shell"),
  composerStatus: document.querySelector("#composer-status"),
  composerSyncNote: document.querySelector("#composer-sync-note"),
  composerTarget: document.querySelector("#composer-target"),
  controlToggleButton: document.querySelector("#control-toggle-button"),
  declineButton: document.querySelector("#decline-button"),
  expandAllButton: document.querySelector("#expand-all-button"),
  feed: document.querySelector("#remote-feed"),
  companionSummonButtons: Array.from(document.querySelectorAll("[data-companion-summon]")),
  filterButtons: Array.from(document.querySelectorAll("[data-filter]")),
  marquee: document.querySelector("#remote-marquee"),
  operatorDiagnostics: document.querySelector("#remote-operator-diagnostics"),
  refreshButton: document.querySelector("#refresh-button"),
  remoteScopeNote: document.querySelector("#remote-scope-note"),
  remoteWindow: document.querySelector("#remote-window"),
  statusPanel: document.querySelector("#remote-status-panel"),
  sidebar: document.querySelector("#remote-sidebar"),
  sidebarGroups: document.querySelector("#remote-sidebar-groups"),
  sidebarOverlay: document.querySelector("#remote-sidebar-overlay"),
  sidebarToggleButton: document.querySelector("#sidebar-toggle-button"),
  remoteTarget: document.querySelector("#remote-target"),
  remoteTitle: document.querySelector("#remote-title"),
  uiStatus: document.querySelector("#remote-ui-status"),
  replyImageInput: document.querySelector("#reply-image-input"),
  replyText: document.querySelector("#reply-text"),
  replyToggleButton: document.querySelector("#reply-toggle-button"),
  queueReplyButton: document.querySelector("#queue-reply-button"),
  sendReplyButton: document.querySelector("#send-reply-button")
};

function isIosTouchDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }

  if (IOS_FOCUS_PLATFORM_REGEX.test(navigator.userAgent || "")) {
    return true;
  }

  return navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1;
}

function configureIosViewport() {
  if (!isIosTouchDevice()) {
    return;
  }

  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (!viewportMeta) {
    return;
  }

  viewportMeta.setAttribute("content", IOS_VIEWPORT_MAX_SCALE_CONTENT);
}

function focusReplyTextAtEnd() {
  if (!nodes.replyText) {
    return;
  }

  const applyFocus = () => {
    try {
      nodes.replyText.focus({ preventScroll: true });
    } catch {
      nodes.replyText.focus();
    }
    const end = nodes.replyText.value.length;
    if (typeof nodes.replyText.setSelectionRange === "function") {
      nodes.replyText.setSelectionRange(end, end);
    }
  };

  if (isIosTouchDevice()) {
    return;
  }

  window.setTimeout(applyFocus, 0);
}

configureIosViewport();

const marqueeTicker = startTicker(nodes.marquee, [
  "initializing session bridge...",
  "tailing live codex events...",
  "arming remote reply path..."
]);

function setComposerStatus(message, tone = "neutral") {
  composerStatus = message;
  composerStatusTone = tone;
}

function speechRecognitionSupported() {
  return Boolean(getSpeechRecognitionCtor(window));
}

function dictationUiModel() {
  const supported = speechRecognitionSupported();
  if (!supported) {
    return {
      indicatorText: "Voice unavailable",
      label: "Voice unavailable",
      live: false,
      meta: "Browser unsupported"
    };
  }

  if (isDictating) {
    return {
      indicatorText: isDictationPressActive ? "Release to stop" : "Listening live",
      label: isDictationPressActive ? "Release to stop" : "Stop voice",
      live: true,
      meta: dictationInterimText ? "Capturing speech" : "Listening"
    };
  }

  return {
    indicatorText: "Hold to talk",
    label: "Dictate",
    live: false,
    meta: "Hold to talk"
  };
}

function hasPointerSupport() {
  return typeof window !== "undefined" && "PointerEvent" in window;
}

function dictationDraft() {
  return composeDictationDraft({
    baseText: dictationBaseText,
    committedText: dictationCommittedText,
    interimText: dictationInterimText
  });
}

function applyDictationDraft({ persist = false } = {}) {
  const nextDraft = dictationDraft();
  if (nodes.replyText.value !== nextDraft) {
    nodes.replyText.value = nextDraft;
  }
  if (persist) {
    persistDraft(draftThreadId || currentThreadId(), nextDraft);
  }
}

function clearDictationState() {
  activeDictation = null;
  dictationBaseText = "";
  dictationCommittedText = "";
  dictationError = "";
  dictationInterimText = "";
  isDictationPressActive = false;
  dictationPointerId = null;
  isDictating = false;
}

function stopDictation() {
  if (!activeDictation) {
    return;
  }

  try {
    activeDictation.stop();
  } catch {
    clearDictationState();
    setComposerStatus("Voice memo cancelled.");
    render();
  }
}

function beginPressDictation(pointerId = null) {
  if (isSendingReply || uiState.selecting || uiState.controlling) {
    return;
  }

  const blockedReason = composeBlockedReason();
  if (blockedReason) {
    setComposerStatus(blockedReason, "error");
    render();
    return;
  }

  isDictationPressActive = true;
  dictationPointerId = pointerId;
  suppressNextDictationClick = true;

  if (!isDictating) {
    try {
      startDictation();
    } catch (error) {
      isDictationPressActive = false;
      dictationPointerId = null;
      setComposerStatus(error.message, "error");
      render();
    }
    return;
  }

  render();
}

function endPressDictation(pointerId = null) {
  if (!isDictationPressActive) {
    return;
  }

  if (pointerId !== null && dictationPointerId !== null && pointerId !== dictationPointerId) {
    return;
  }

  isDictationPressActive = false;
  dictationPointerId = null;
  if (isDictating) {
    stopDictation();
  } else {
    render();
  }

  window.setTimeout(() => {
    suppressNextDictationClick = false;
  }, 0);
}

function finishDictation() {
  const finalDraft = dictationDraft();
  const hadTranscript = Boolean(finalDraft.trim());
  const errorMessage = dictationError;

  applyDictationDraft({ persist: true });
  clearDictationState();

  if (errorMessage) {
    setComposerStatus(errorMessage, errorMessage === "Voice memo cancelled." ? "neutral" : "error");
  } else if (hadTranscript) {
    setComposerStatus("Voice memo ready. Queue or steer it.", "success");
    scheduleComposerStatusReset(2400);
  } else {
    setComposerStatus("Voice memo cancelled.");
  }
}

function startDictation() {
  const SpeechRecognitionCtor = getSpeechRecognitionCtor(window);
  if (!SpeechRecognitionCtor) {
    throw new Error("Voice memo is not available in this browser.");
  }

  const blockedReason = composeBlockedReason();
  if (blockedReason) {
    throw new Error(blockedReason);
  }

  if (!currentThreadId()) {
    throw new Error("Select a session before dictating.");
  }

  const recognition = new SpeechRecognitionCtor();
  dictationBaseText = nodes.replyText.value.trimEnd();
  dictationCommittedText = "";
  dictationError = "";
  dictationInterimText = "";
  activeDictation = recognition;

  if (!isComposerOpen) {
    isComposerOpen = true;
  }

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = navigator.language || "en-US";

  recognition.addEventListener("start", () => {
    isDictating = true;
    setComposerStatus("Listening...", "sending");
    render();
  });

  recognition.addEventListener("result", (event) => {
    const finals = [];
    let interim = "";

    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = String(result?.[0]?.transcript || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!transcript) {
        continue;
      }

      if (result.isFinal) {
        finals.push(transcript);
      } else {
        interim = transcript;
      }
    }

    dictationCommittedText = finals.join(" ");
    dictationInterimText = interim;
    applyDictationDraft();
    setComposerStatus(interim ? "Listening..." : "Heard you. Tap stop when you're done.", "sending");
    render();
  });

  recognition.addEventListener("error", (event) => {
    dictationError = speechRecognitionErrorMessage(event.error);
  });

  recognition.addEventListener("end", () => {
    finishDictation();
    render();
  });

  try {
    recognition.start();
  } catch (error) {
    clearDictationState();
    throw new Error(error?.message || "Voice memo could not start.");
  }
}

function settleSelectionIntent() {
  if (!selectionIntent) {
    return false;
  }

  const result = reconcileSelectionIntent(selectionIntent, currentLiveState);
  selectionIntent = result.intent;
  if (result.settled) {
    uiState.selecting = false;
    noteRoomStatusHold(selectedThreadIdFromState(currentLiveState));
  }
  return result.settled;
}

function selectedThreadIdFromState(state = null) {
  return String(state?.selectedThreadId || state?.selectedThreadSnapshot?.thread?.id || "").trim();
}

function noteRoomStatusHold(threadId, holdMs = ROOM_STATUS_SETTLE_MS) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) {
    roomStatusHoldThreadId = "";
    roomStatusHoldUntil = 0;
    return;
  }

  roomStatusHoldThreadId = normalizedThreadId;
  roomStatusHoldUntil = Date.now() + holdMs;
}

function syncRoomStatusHold(previousState = null, nextState = null) {
  const previousThreadId = selectedThreadIdFromState(previousState);
  const nextThreadId = selectedThreadIdFromState(nextState);

  if (!nextThreadId) {
    roomStatusHoldThreadId = "";
    roomStatusHoldUntil = 0;
    return;
  }

  if (nextThreadId !== previousThreadId) {
    noteRoomStatusHold(nextThreadId);
    return;
  }

  const previousWatcherConnected = Boolean(previousState?.status?.watcherConnected);
  const nextWatcherConnected = Boolean(nextState?.status?.watcherConnected);
  if (previousWatcherConnected && !nextWatcherConnected) {
    noteRoomStatusHold(nextThreadId);
    return;
  }

  if (roomStatusHoldThreadId && roomStatusHoldThreadId !== nextThreadId) {
    roomStatusHoldThreadId = "";
    roomStatusHoldUntil = 0;
  }
}

function roomStatusPending(thread = null, status = null, snapshot = null) {
  const threadId = String(thread?.id || "").trim();
  if (!threadId) {
    return false;
  }

  if (Boolean(snapshot?.transcriptHydrating)) {
    return true;
  }

  if (!Boolean(status?.watcherConnected)) {
    return true;
  }

  return roomStatusHoldThreadId === threadId && Date.now() < roomStatusHoldUntil;
}

function draftStorageKey(threadId) {
  return scopedThreadStorageKey({
    prefix: DRAFT_STORAGE_PREFIX,
    scopeId: surfaceClientId,
    threadId
  });
}

function queueStorageKey(threadId) {
  return scopedThreadStorageKey({
    prefix: QUEUE_STORAGE_PREFIX,
    scopeId: surfaceClientId,
    threadId
  });
}

function legacyDraftStorageKey(threadId) {
  return `${DRAFT_STORAGE_PREFIX}${threadId}`;
}

function legacyQueueStorageKey(threadId) {
  return `${QUEUE_STORAGE_PREFIX}${threadId}`;
}

function loadPersistedDraft(threadId) {
  if (!threadId) {
    return "";
  }

  try {
    const raw =
      window.localStorage.getItem(draftStorageKey(threadId)) ||
      window.localStorage.getItem(legacyDraftStorageKey(threadId));
    if (!raw) {
      return "";
    }
    const parsed = JSON.parse(raw);
    return typeof parsed?.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

function loadPersistedQueue(threadId) {
  if (!threadId) {
    return [];
  }

  try {
    const raw =
      window.localStorage.getItem(queueStorageKey(threadId)) ||
      window.localStorage.getItem(legacyQueueStorageKey(threadId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((reply) => ({
        attachments: cloneReplyAttachments(Array.isArray(reply?.attachments) ? reply.attachments : []),
        id: String(reply?.id || "").trim(),
        queuedAt: String(reply?.queuedAt || "").trim(),
        text: String(reply?.text || "").trim(),
        threadId: String(reply?.threadId || threadId).trim()
      }))
      .filter((reply) => reply.id && reply.threadId && (reply.text || reply.attachments.length));
  } catch {
    return [];
  }
}

function persistDraft(threadId = draftThreadId || currentThreadId(), text = nodes.replyText.value) {
  if (!threadId) {
    return;
  }

  try {
    const nextText = String(text || "").trimEnd();
    if (!nextText) {
      window.localStorage.removeItem(draftStorageKey(threadId));
      window.localStorage.removeItem(legacyDraftStorageKey(threadId));
      return;
    }

    window.localStorage.setItem(
      draftStorageKey(threadId),
      JSON.stringify({
        text: nextText,
        updatedAt: new Date().toISOString()
      })
    );
    window.localStorage.removeItem(legacyDraftStorageKey(threadId));
  } catch {
    return;
  }
}

function restoreDraft(threadId, { force = false } = {}) {
  if (!threadId || isSendingReply || isDictating) {
    return;
  }

  if (!force && draftThreadId === threadId) {
    return;
  }

  if (draftThreadId && draftThreadId !== threadId) {
    persistDraft(draftThreadId);
  }

  draftThreadId = threadId;
  if (pendingAttachments.length || pendingOutgoingText || pendingOutgoingAttachments.length) {
    return;
  }

  const storedDraft = loadPersistedDraft(threadId);
  if (nodes.replyText.value !== storedDraft) {
    nodes.replyText.value = storedDraft;
  }
}

function clearPersistedDraft(threadId = draftThreadId || currentThreadId()) {
  if (!threadId) {
    return;
  }

  try {
    window.localStorage.removeItem(draftStorageKey(threadId));
    window.localStorage.removeItem(legacyDraftStorageKey(threadId));
  } catch {
    return;
  }
}

function persistQueuedReplies(threadId, replies = queuedRepliesByThreadId.get(threadId) || []) {
  if (!threadId) {
    return;
  }

  try {
    if (!replies.length) {
      window.localStorage.removeItem(queueStorageKey(threadId));
      window.localStorage.removeItem(legacyQueueStorageKey(threadId));
      return;
    }

    window.localStorage.setItem(queueStorageKey(threadId), JSON.stringify(replies));
    window.localStorage.removeItem(legacyQueueStorageKey(threadId));
  } catch {
    return;
  }
}

function hasComposerPayload() {
  return Boolean(nodes.replyText.value.trim() || pendingAttachments.length);
}

function clearStagedCompanionWakeKey() {
  stagedCompanionWakeKey = "";
}

function manualAdvisorLabel(advisorId) {
  return advisorId ? "Note" : "Companion";
}

function scheduleComposerStatusReset(delayMs = 1400) {
  window.setTimeout(() => {
    if (isSendingReply || isDictating || composerStatusTone === "error") {
      return;
    }

    setComposerStatus("Ready");
    render();
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
    return { message: "Connecting to Dextunnel...", tone: "busy" };
  }

  if (uiState.controlling) {
    return { message: "Updating remote control...", tone: "busy" };
  }

  if (uiState.selecting) {
    return { message: selectionIntentMessage(selectionIntent, "Switching shared room..."), tone: "busy" };
  }

  if (uiState.refreshing) {
    return { message: "", tone: "neutral" };
  }

  if (uiState.submittingAction) {
    return { message: interactionBusyNotice(pending, uiState.submittingAction), tone: "busy" };
  }

  if (companionActionState) {
    return { message: "Updating shared note...", tone: "busy" };
  }

  if (manualAdvisorAction) {
    return { message: "Preparing shared note...", tone: "busy" };
  }

  if (isSendingReply) {
    return { message: "Sending remote reply...", tone: "busy" };
  }

  if (isDictating) {
    return { message: "Listening for voice memo...", tone: "busy" };
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
  const busy = threadBusyState({
    activeTurnId: liveThread?.activeTurnId || "",
    threadStatus: liveThread?.status || "",
    writeLockStatus: nextState?.status?.writeLock?.status || ""
  });
  if (!busy) {
    return;
  }

  const step = previousPending.flowStep || 1;
  const submittedSummary = interactionActionSummary(previousPending, action);
  actionHandoffState = {
    actionKind: "handoff",
    detail: `${submittedSummary} ${step > 1 ? "Waiting for the next request in this turn..." : "Waiting for Codex to continue..."}`.trim(),
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

function markLiveActivity() {
  lastLiveActivityAt = Date.now();
}

function markUserIntent() {
  lastUserIntentAt = Date.now();
}

function remoteEngaged(threadId = currentThreadId()) {
  return Boolean(
    isComposerOpen ||
      isSendingReply ||
      pendingAttachments.length ||
      pendingOutgoingAttachments.length ||
      pendingOutgoingText.trim() ||
      queuedRepliesForThread(threadId).length ||
      currentLiveState?.pendingInteraction ||
      hasRemoteControl(threadId) ||
      Date.now() - lastUserIntentAt <= CONTROL_RENEW_ACTIVE_WINDOW_MS
  );
}

function buildPresencePayload() {
  const threadId = currentThreadId() || currentLiveState?.selectedThreadId || "";
  if (!threadId) {
    return null;
  }

  return {
    clientId: surfaceAuthClientId,
    engaged: remoteEngaged(threadId),
    focused: document.hasFocus(),
    surface: "remote",
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
    label: "remote",
    state: payload.visible && payload.focused && payload.engaged ? "active" : payload.visible ? "open" : "background",
    surface: "remote"
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
    surface: "remote",
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

function currentThreadId() {
  return currentLiveState?.selectedThreadSnapshot?.thread?.id || currentLiveState?.selectedThreadId || "";
}

function controlLeaseForThread(threadId = currentThreadId()) {
  const lease = currentLiveState?.status?.controlLeaseForSelection || null;
  if (!lease) {
    return null;
  }

  if (threadId && lease.threadId && lease.threadId !== threadId) {
    return null;
  }

  return lease;
}

function hasAnyRemoteControl(threadId = currentThreadId()) {
  const lease = controlLeaseForThread(threadId);
  return Boolean(lease && (lease.owner === "remote" || lease.source === "remote"));
}

function hasRemoteControl(threadId = currentThreadId()) {
  const lease = controlLeaseForThread(threadId);
  return Boolean(
    lease &&
      (lease.owner === "remote" || lease.source === "remote") &&
      (!lease.ownerClientId || lease.ownerClientId === surfaceAuthClientId)
  );
}

function describeControlEvent(event, { forRemote = false } = {}) {
  if (!event?.action) {
    return "";
  }

  const actorLabel = describeSurfaceActor(event.actor, event.actorClientId, { localSurface: "remote" });

  if (event.action === "claim") {
    if (forRemote && event.actor === "remote" && event.actorClientId === surfaceAuthClientId) {
      return "Remote control active.";
    }

    return event.actor === "remote" ? `${actorLabel} control active.` : `${actorLabel} claimed control.`;
  }

  if (event.action === "release") {
    if (event.cause === "expired") {
      return "Remote control expired.";
    }

    if (forRemote && event.actor === "host") {
      return `${actorLabel} released remote control.`;
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
    return surface === "remote" ? "This remote" : "This host";
  }

  const suffix = shortSurfaceClientLabel(clientId);
  return suffix ? `${base} ${suffix}` : base;
}

function controlOwnerLabel(lease) {
  if (!lease) {
    return "";
  }

  return describeSurfaceActor(lease.source || lease.owner || "remote", lease.ownerClientId || null, {
    localSurface: "remote"
  });
}

function handleControlEventNotice(previousState, nextState) {
  const event = nextState?.status?.lastControlEventForSelection || null;
  if (!event?.id) {
    return;
  }

  if (!previousState) {
    lastHandledControlEventId = event.id;
    return;
  }

  if (lastHandledControlEventId === event.id) {
    return;
  }

  lastHandledControlEventId = event.id;
  const feedback = controlEventStatusState({
    event,
    hasDraft: Boolean(
      nodes.replyText.value.trim() ||
        pendingAttachments.length ||
        pendingOutgoingAttachments.length ||
        pendingOutgoingText.trim()
    ),
    isLocalActor: event.actor === "remote" && event.actorClientId === surfaceAuthClientId,
    queuedCount: queuedRepliesForThread(currentThreadId()).length
  });
  if (feedback) {
    setComposerStatus(feedback, "success");
    scheduleComposerStatusReset(2600);
    return;
  }

  const message = describeControlEvent(event, { forRemote: true });
  if (message) {
    setTransientUiNotice(message, "neutral", 2000);
  }
}

function handleControlLeaseTransition(previousState, nextState) {
  const previousThreadId = previousState?.selectedThreadSnapshot?.thread?.id || previousState?.selectedThreadId || "";
  const nextThreadId = nextState?.selectedThreadSnapshot?.thread?.id || nextState?.selectedThreadId || "";
  if (!previousThreadId || !nextThreadId || previousThreadId !== nextThreadId) {
    return;
  }

  const previousLease = previousState?.status?.controlLeaseForSelection || null;
  const nextLease = nextState?.status?.controlLeaseForSelection || null;
  const previousHadRemoteControl = Boolean(previousLease && (previousLease.owner === "remote" || previousLease.source === "remote"));
  const nextHasRemoteControl = Boolean(nextLease && (nextLease.owner === "remote" || nextLease.source === "remote"));

  const releaseFeedback = controlReleaseFeedbackState({
    hasDraft: Boolean(
      nodes.replyText.value.trim() ||
        pendingAttachments.length ||
        pendingOutgoingAttachments.length ||
        pendingOutgoingText.trim()
    ),
    isControlling: uiState.controlling,
    isSendingReply,
    nextHasRemoteControl,
    previousHadRemoteControl
  });

  if (releaseFeedback) {
    setComposerStatus(releaseFeedback, "success");
    scheduleComposerStatusReset();
  }
}

function controlBlockedReason(threadId = currentThreadId()) {
  const lease = controlLeaseForThread(threadId);
  return controlBlockedReasonState({
    hasAnyRemoteControl: hasAnyRemoteControl(threadId),
    hasRemoteControl: hasRemoteControl(threadId),
    ownerLabel: controlOwnerLabel(lease),
    threadId
  });
}

function sendBlockedReason(threadId = currentThreadId()) {
  const lease = controlLeaseForThread(threadId);
  return sendBlockedReasonState({
    hasAnyRemoteControl: hasAnyRemoteControl(threadId),
    hasRemoteControl: hasRemoteControl(threadId),
    ownerLabel: controlOwnerLabel(lease),
    pendingInteraction: Boolean(currentLiveState?.pendingInteraction),
    sessionReason: sessionBlockedReason(),
    threadId
  });
}

function queuedRepliesForThread(threadId = currentThreadId()) {
  if (!threadId) {
    return [];
  }

  if (!queuedRepliesByThreadId.has(threadId)) {
    const storedQueue = loadPersistedQueue(threadId);
    if (storedQueue.length) {
      queuedRepliesByThreadId.set(threadId, storedQueue);
    }
  }

  return queuedRepliesByThreadId.get(threadId) || [];
}

function setQueuedRepliesForThread(threadId, replies) {
  if (!threadId) {
    return;
  }

  if (!replies.length) {
    queuedRepliesByThreadId.delete(threadId);
    persistQueuedReplies(threadId, []);
    return;
  }

  queuedRepliesByThreadId.set(threadId, replies);
  persistQueuedReplies(threadId, replies);
}

function removeQueuedReply(threadId, replyId) {
  if (!threadId || !replyId) {
    return;
  }

  const nextQueue = queuedRepliesForThread(threadId).filter((reply) => reply.id !== replyId);
  setQueuedRepliesForThread(threadId, nextQueue);
}

function clearQueuedReplies(threadId = currentThreadId()) {
  if (!threadId) {
    return;
  }

  setQueuedRepliesForThread(threadId, []);
}

function resetComposerDraft({ keepStatus = false } = {}) {
  if (isDictating) {
    stopDictation();
  }
  pendingOutgoingText = "";
  pendingOutgoingAttachments = [];
  pendingAttachments = [];
  isComposerOpen = false;
  isSendingReply = false;
  nodes.replyText.value = "";
  nodes.replyImageInput.value = "";
  renderAttachments();
  if (!keepStatus) {
    setComposerStatus("Ready");
  }
}

function formatAttachmentSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

function summarizeReplyPayload({ text = "", attachments = [] } = {}) {
  const parts = [];
  const trimmed = String(text || "").trim();
  if (trimmed) {
    parts.push(trimmed);
  }

  if (attachments.length) {
    const label = attachments.length === 1 ? "image attached" : "images attached";
    parts.push(`[${attachments.length} ${label}]`);
  }

  return parts.join("\n\n");
}

function shortPathLabel(value) {
  const parts = String(value || "")
    .split("/")
    .filter(Boolean);

  return parts.at(-1) || value || "";
}

function remoteParticipant() {
  return {
    id: "remote",
    label: "remote",
    lane: "remote",
    role: "live",
    token: "remote"
  };
}

function renderAttachments() {
  if (!pendingAttachments.length) {
    setHtmlIfChanged(nodes.attachmentList, "", "attachments:empty");
    setPanelHidden(nodes.attachmentList, true);
    return;
  }

  setPanelHidden(nodes.attachmentList, false);
  const html = pendingAttachments
    .map((attachment) => {
      const meta = [attachment.type?.replace("image/", "") || "image", formatAttachmentSize(attachment.size)]
        .filter(Boolean)
        .join(" / ");

      return `
        <article class="attachment-chip">
          <img src="${attachment.dataUrl}" alt="${escapeHtml(attachment.name || "attachment preview")}" class="attachment-preview">
          <div class="attachment-copy">
            <strong>${escapeHtml(attachment.name || "image")}</strong>
            ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
          </div>
          <button type="button" class="attachment-remove" data-attachment-id="${escapeHtml(attachment.id)}">Remove</button>
        </article>
      `;
    })
    .join("");
  const signature = `attachments:${pendingAttachments.map((attachment) => `${attachment.id}|${attachment.name}|${attachment.size}`).join("||")}`;
  setHtmlIfChanged(nodes.attachmentList, html, signature);
}

function queueEntryPreview(reply) {
  return summarizeReplyPayload(reply).replace(/\s+/g, " ").trim();
}

function renderQueuePanel() {
  const queue = queuedRepliesForThread();
  if (!queue.length) {
    setPanelHidden(nodes.composerQueueShell, true);
    setHtmlIfChanged(nodes.composerQueueList, "", "queue:empty");
    return;
  }

  const html = queue
    .map((reply, index) => `
      <article class="queue-item">
        <div class="queue-item-copy">
          <span class="queue-item-slot">${index + 1}</span>
          <span class="queue-item-preview">${escapeHtml(queueEntryPreview(reply) || "Queued reply")}</span>
        </div>
        <button
          type="button"
          class="queue-item-remove"
          data-queued-reply-id="${escapeHtml(reply.id)}"
          aria-label="Remove queued reply ${index + 1}"
        >Remove</button>
      </article>
    `)
    .join("");
  const signature = `queue:${queue.map((reply) => `${reply.id}|${reply.queuedAt}|${queueEntryPreview(reply)}`).join("||")}`;
  setPanelHidden(nodes.composerQueueShell, false);
  setHtmlIfChanged(nodes.composerQueueList, html, signature);
}

function clearAttachments() {
  pendingAttachments = [];
  nodes.replyImageInput.value = "";
  renderAttachments();
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
    const nextEntry = { ...entry };
    if (entry?.participant?.role === "advisory" && entry.kind === "commentary") {
      const stageAction =
        stagedCompanionWakeKey && stagedCompanionWakeKey === entry.key
          ? {
              action: "stage",
              disabled: true,
              label: "Staged",
              tone: "success"
            }
          : {
              action: "stage",
              label: entry.wakeKind === "review" ? "Stage review" : "Stage recap"
            };
      nextEntry.actions = [stageAction, ...(entry.actions || [])];
    }
    if (companionActionState?.key && entry.key === companionActionState.key) {
      nextEntry.actionState = {
        action: companionActionState.action,
        busy: true
      };
    }

    const isExpanded = expandAllCards || expandedEntryKeys.has(entryKey(entry));
    const isNew = isNewCard(entry);
    return {
      html: renderTranscriptCard(nextEntry, {
        expanded: isExpanded,
        isNew
      }),
      key: entryKey(entry),
      signature: JSON.stringify({
        actionState: nextEntry.actionState || null,
        actions: nextEntry.actions || null,
        entry: nextEntry,
        expanded: isExpanded
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function resetCardHistoryIfNeeded() {
  const threadId = currentLiveState?.selectedThreadSnapshot?.thread?.id || null;
  if (threadId === renderedThreadId) {
    return;
  }

  restoreDraft(threadId, { force: true });
  renderedThreadId = threadId;
  pendingScrollToLatest = true;
  lastRenderedFeedTopKey = null;
  expandAllCards = surfaceViewState.loadExpansionMode(threadId || "none") === "expanded";
  seenCardKeys.clear();
  expandedEntryKeys.clear();
  expandedFeedSections.clear();
  for (const key of surfaceViewState.loadExpandedSections(threadId || "none")) {
    expandedFeedSections.add(key);
  }
  const historyState = historyStateForThread(threadId);
  if (historyState && historyState.items.length === 0) {
    historyState.awaitingUserScroll = false;
    historyState.beforeIndex = null;
    historyState.hasMore = true;
    historyState.loading = false;
    historyState.resumeAfterScrollY = null;
  }
  hasRenderedOnce = false;
}

function historyStateForThread(threadId = currentThreadId()) {
  if (!threadId) {
    return null;
  }

  if (!transcriptHistoryByThreadId.has(threadId)) {
    transcriptHistoryByThreadId.set(threadId, {
      awaitingUserScroll: false,
      beforeIndex: null,
      hasMore: true,
      items: [],
      loading: false,
      resumeAfterScrollY: null
    });
  }

  return transcriptHistoryByThreadId.get(threadId);
}

function entryMatchesFeedFilter(entry) {
  if (!entry) {
    return false;
  }

  if (isAdvisoryEntry(entry)) {
    return false;
  }

  if (entry.role === "tool") {
    return Boolean(feedFilters.tools);
  }

  if (isConversationEntry(entry)) {
    return Boolean(feedFilters.thread);
  }

  if (isSystemNoticeEntry(entry)) {
    return false;
  }

  return Boolean(feedFilters.updates);
}

function mergeTranscriptEntries(...groups) {
  const merged = [];
  const seen = new Set();

  for (const group of groups) {
    for (const entry of Array.isArray(group) ? group : []) {
      const key = entryDedupKey(entry);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(entry);
    }
  }

  return merged;
}

function currentTranscriptEntries() {
  const recentTranscript = currentSurfaceTranscript({
    bootstrapSnapshot: currentSnapshot,
    liveState: currentLiveState
  });
  const historyItems = historyStateForThread()?.items || [];

  return mergeTranscriptEntries(historyItems, recentTranscript)
    .map((entry, index) => ({
      ...entry,
      transcriptOrder: index
    }))
    .slice()
    .sort(compareEntryChronology);
}

function isNewCard(entry) {
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

function buildEntries() {
  const transcript = currentTranscriptEntries();
  const companionWakeups = currentLiveState?.selectedCompanion?.wakeups || [];
  const entries = [...companionWakeups, ...transcript]
    .filter((entry) => !shouldHideTranscriptEntry(entry));

  const syntheticEntries = [];

  if (pendingOutgoingText || pendingOutgoingAttachments.length) {
    const pendingText = summarizeReplyPayload({
      attachments: pendingOutgoingAttachments,
      text: pendingOutgoingText
    });
    syntheticEntries.push({
      id: "pending-live-reply",
      lane: "remote",
      origin: "remote",
      participant: remoteParticipant(),
      role: "user",
      kind: "pending",
      text: pendingText,
      timestamp: new Date().toISOString()
    });
  }

  const queue = queuedRepliesForThread();
  if (queue.length) {
    queue.forEach((reply, index) => {
      syntheticEntries.push({
        id: reply.id,
        lane: "remote",
        origin: "remote",
        participant: remoteParticipant(),
        queuePosition: index + 1,
        role: "user",
        kind: "queued",
        text: summarizeReplyPayload(reply),
        timestamp: reply.queuedAt
      });
    });
  }

  return [...syntheticEntries, ...entries];
}

function advisoryDraftForEntry(entry) {
  if (entry?.wakeKind === "review") {
    return "Please do a quick risk review of the latest changes and call out anything risky, surprising, or missing.";
  }

  return "Please give me a concise recap of the last settled step in 3-5 bullets, plus any follow-up I should keep in mind.";
}

function stageCompanionPrompt(entry) {
  const prompt = advisoryDraftForEntry(entry);
  const currentValue = nodes.replyText.value.trim();
  const alreadyStaged = Boolean(currentValue) && currentValue.includes(prompt);
  if (!currentValue) {
    nodes.replyText.value = prompt;
  } else if (!alreadyStaged) {
    nodes.replyText.value = `${nodes.replyText.value.trimEnd()}\n\n${prompt}`;
  }

  stagedCompanionWakeKey = entry?.key || "";
  isComposerOpen = true;
  persistDraft();
  const wakeLabel = entry?.wakeKind === "review" ? "Review" : "Recap";
  setComposerStatus(
    hasRemoteControl()
      ? `${wakeLabel} staged. Review before send.`
      : `${wakeLabel} staged. Take control to send.`,
    "success"
  );
  setTransientUiNotice(`${wakeLabel} prompt staged.`, "success", 2200);
  render();
  scheduleComposerStatusReset(1800);
  focusReplyTextAtEnd();
}

function renderFilterButtons(entries) {
  for (const button of nodes.filterButtons) {
    const filter = button.dataset.filter;
    const active = Boolean(feedFilters[filter]);
    button.classList.toggle("is-active", active);
    button.textContent = humanize(filter);
  }

  if (nodes.expandAllButton) {
    nodes.expandAllButton.textContent = expandAllCards ? "Collapse" : "Expand";
    nodes.expandAllButton.classList.toggle("is-active", expandAllCards);
  }
}

function isMobileSidebarLayout() {
  return globalThis.innerWidth <= SIDEBAR_MOBILE_BREAKPOINT_PX;
}

function setSidebarExpanded(nextExpanded, { persist = true } = {}) {
  sidebarExpanded = Boolean(nextExpanded);
  if (persist) {
    surfaceViewState.saveSidebarMode(sidebarExpanded ? "expanded" : "collapsed");
  }
}

let lastSidebarMobileLayout = isMobileSidebarLayout();

function sidebarThreadTimestamp(thread) {
  return formatSessionTimestamp(thread?.updatedAt || 0) || "";
}

function renderSidebar() {
  const threads = currentLiveState?.threads || [];
  const groups = groupThreadsByProject(threads);
  const selectedProject = currentLiveState?.selectedProjectCwd || "";
  const selectedThread = currentLiveState?.selectedThreadId || "";
  const pendingThreadId = uiState.selecting ? selectionIntent?.threadId || "" : "";
  const disabled = uiState.selecting || uiState.refreshing || uiState.booting || isDictating;

  if (nodes.remoteWindow) {
    nodes.remoteWindow.classList.toggle("is-sidebar-open", sidebarExpanded);
  }
  if (nodes.sidebarOverlay) {
    setPanelHidden(nodes.sidebarOverlay, !(sidebarExpanded && isMobileSidebarLayout()));
  }
  if (nodes.sidebarToggleButton) {
    nodes.sidebarToggleButton.setAttribute("aria-expanded", sidebarExpanded ? "true" : "false");
    nodes.sidebarToggleButton.setAttribute("aria-label", sidebarExpanded ? "Collapse thread menu" : "Expand thread menu");
  }

  if (groups.length === 0) {
    setHtmlIfChanged(
      nodes.sidebarGroups,
      '<div class="remote-sidebar-empty">No shared threads yet.</div>',
      "remote-sidebar:empty"
    );
    return;
  }

  const html = groups
    .map((group) => {
      const rows = group.threads
        .map((thread) => {
          const selected = thread.id === selectedThread;
          const pending = !selected && thread.id === pendingThreadId;
          const classes = ["remote-thread-row"];
          if (selected) {
            classes.push("is-selected");
          }
          if (pending) {
            classes.push("is-pending");
          }
          const stamp = sidebarThreadTimestamp(thread);
          return `
            <button
              type="button"
              class="${classes.join(" ")}"
              data-sidebar-thread-id="${escapeHtml(thread.id)}"
              data-sidebar-cwd="${escapeHtml(thread.cwd || group.cwd || "")}"
              ${disabled ? "disabled" : ""}
            >
              <span class="remote-thread-row-title">${escapeHtml(threadDisplayTitle(thread))}</span>
              <span class="remote-thread-row-meta">
                <span>${pending ? "Switching..." : stamp || shortThreadId(thread.id)}</span>
              </span>
            </button>
          `;
        })
        .join("");
      const active = group.cwd === selectedProject || group.threads.some((thread) => thread.id === selectedThread);
      return `
        <section class="remote-sidebar-group${active ? " is-active" : ""}">
          <h2 class="remote-sidebar-group-label">${escapeHtml(group.label)}</h2>
          <div class="remote-thread-list">${rows}</div>
        </section>
      `;
    })
    .join("");

  setHtmlIfChanged(
    nodes.sidebarGroups,
    html,
    `remote-sidebar:${JSON.stringify(groups.map((group) => ({
      active: group.cwd === selectedProject || group.threads.some((thread) => thread.id === selectedThread),
      cwd: group.cwd,
      threads: group.threads.map((thread) => ({
        id: thread.id,
        pending: thread.id === pendingThreadId,
        selected: thread.id === selectedThread,
        stamp: sidebarThreadTimestamp(thread),
        title: threadDisplayTitle(thread)
      }))
    })))}:${disabled ? "disabled" : "ready"}`
  );
}

function sessionBlockedReason() {
  const liveThread = currentLiveState?.selectedThreadSnapshot?.thread || null;
  const status = currentLiveState?.status || null;

  return sessionBlockedReasonState({
    hasLiveThread: Boolean(liveThread?.id),
    watcherConnected: Boolean(status?.watcherConnected)
  });
}

function composeBlockedReason() {
  return composeBlockedReasonState({
    pendingInteraction: Boolean(currentLiveState?.pendingInteraction),
    sessionReason: sessionBlockedReason()
  });
}

function threadBusy(status = currentLiveState?.status || null, liveThread = currentLiveState?.selectedThreadSnapshot?.thread || null) {
  return threadBusyState({
    activeTurnId: liveThread?.activeTurnId || "",
    threadStatus: liveThread?.status || "",
    isSendingReply,
    writeLockStatus: status?.writeLock?.status || ""
  });
}

function queueSummary(threadId = currentThreadId()) {
  return queueSummaryState(queuedRepliesForThread(threadId).length);
}

function hasDraftIntent() {
  return Boolean(
    nodes.replyText.value.trim() ||
      pendingAttachments.length ||
      pendingOutgoingAttachments.length ||
      pendingOutgoingText.trim()
  );
}

function shouldRenewControlLease() {
  const threadId = currentThreadId();
  if (!threadId || !hasRemoteControl(threadId) || document.visibilityState !== "visible") {
    return false;
  }

  const hasRecentIntent = Date.now() - lastUserIntentAt < CONTROL_RENEW_ACTIVE_WINDOW_MS;
  const hasQueuedReplies = queuedRepliesForThread(threadId).length > 0;
  return Boolean(
    hasRecentIntent ||
      hasDraftIntent() ||
      hasQueuedReplies ||
      isComposerOpen ||
      isSendingReply ||
      uiState.submittingAction ||
      currentLiveState?.pendingInteraction
  );
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

function renderStatuses() {
  const status = currentLiveState?.status || {};
  const liveThread = currentLiveState?.selectedThreadSnapshot?.thread || null;
  const selectedChannel = currentLiveState?.selectedChannel || currentLiveState?.selectedThreadSnapshot?.channel || null;
  const selectedSnapshot = currentLiveState?.selectedThreadSnapshot || null;
  const selectedAttachments = mergeSurfaceAttachments(currentLiveState?.selectedAttachments || [], localSurfaceAttachment());
  const controlActive = hasRemoteControl(liveThread?.id || "");
  const roomHydrating = roomStatusPending(liveThread, status, selectedSnapshot);
  const suppressBridgeDiagnostics = bridgeState.streamState !== "live" || uiState.booting || uiState.selecting;
  const operatorDiagnostics = describeOperatorDiagnostics({
    diagnostics: status.diagnostics || [],
    ownsControl: controlActive,
    status,
    surface: "remote"
  }).filter((entry) => {
    if (entry.code === "host_unavailable" || entry.code === "bridge_unavailable") {
      return false;
    }

    if (suppressBridgeDiagnostics && entry.code === "bridge_last_error") {
      return false;
    }

    return true;
  });
  const busy = threadBusy(status, liveThread);
  const queued = queueSummary(liveThread?.id || "");
  const queuedCount = queuedRepliesForThread(liveThread?.id || "").length;
  const hasDraftPayload = hasComposerPayload();
  const threadState = describeThreadState({
    pendingInteraction: currentLiveState?.pendingInteraction,
    status,
    thread: liveThread
  });
  const attachmentSummary = formatSurfaceAttachmentSummary(selectedAttachments);
  const pendingTitle = uiState.selecting ? selectionIntentTitle(selectionIntent) : "";
  const channelLabel = selectedChannel?.channelSlug || liveThread?.name || (liveThread?.id ? `#${shortThreadId(liveThread.id)}` : "");
  const remoteScopeNote = describeRemoteScopeNote({
    channelLabel,
    hasSelectedThread: Boolean(liveThread?.id)
  });
  const hasVisibleTranscript = liveThread?.id && currentTranscriptEntries().length > 0;
  const selectionPendingSnapshot = Boolean(currentLiveState?.selectedThreadId) && !liveThread?.id;

  nodes.remoteTitle.textContent = pendingTitle || selectedChannel?.channelSlug || liveThread?.name || currentSnapshot?.session?.title || "#connecting";
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
      nodes.operatorDiagnostics,
      diagnosticsHtml,
      `remote-diagnostics:${operatorDiagnostics.map((entry) => `${entry.code}:${entry.label}`).join("|")}`
    );
    setPanelHidden(nodes.operatorDiagnostics, false);
  } else {
    setHtmlIfChanged(nodes.operatorDiagnostics, "", "remote-diagnostics:empty");
    setPanelHidden(nodes.operatorDiagnostics, true);
  }
  const controllerLabel = controlOwnerLabel(status.controlLeaseForSelection || null);
  nodes.remoteTarget.textContent = liveThread?.id
    ? [
        `server ${selectedChannel?.serverLabel || projectLabel(liveThread.cwd || "")}`,
        attachmentSummary,
        controllerLabel && controlActive ? `${controllerLabel.toLowerCase()} control` : controlActive ? "control active" : "",
        queued,
        threadState !== "ready" ? threadState : ""
      ]
        .filter(Boolean)
        .join(" // ")
    : "Select a project and session.";
  nodes.remoteScopeNote.textContent = remoteScopeNote;
  setPanelHidden(nodes.remoteScopeNote, true);
  nodes.composerTarget.textContent = liveThread?.id
    ? `${selectedChannel?.channelSlug || `#${shortThreadId(liveThread.id)}`} // shared thread // ${
        queuedCount ? `${queuedCount} queued` : controlActive ? "control active" : "steer ready"
      }`
    : "No live target";
  nodes.composerScopeNote.textContent = remoteScopeNote;
  setPanelHidden(nodes.composerScopeNote, !remoteScopeNote);
  nodes.composerSyncNote.textContent = "";
  setPanelHidden(nodes.composerSyncNote, true);

  let bridgeStatusLine = "Loading room...";
  const busyNotice = uiBusyNotice();

  if (bridgeState.streamState !== "live") {
    bridgeStatusLine = currentLiveState ? "Reconnecting..." : "Connecting...";
  } else if (liveThread?.id && roomHydrating) {
    bridgeStatusLine = status.lastError
      ? `Reconnecting ${channelLabel || "room"}...`
      : hasVisibleTranscript
        ? `Loading more from ${channelLabel || "room"}...`
        : `Loading ${channelLabel || "room"}...`;
  } else if (selectionPendingSnapshot) {
    bridgeStatusLine = status.lastError ? `Reconnecting ${channelLabel || "room"}...` : `Loading ${channelLabel || "room"}...`;
  } else if (status.watcherConnected || hasVisibleTranscript) {
    const liveBits = [];
    if (controlActive) {
      liveBits.push("Remote control active");
    }
    if (queued) {
      liveBits.push(queued);
    }
    if (threadState !== "ready") {
      liveBits.push(threadState);
    }
    bridgeStatusLine = liveBits.join(" // ") || "Session bridge online";
  } else if (status.lastError) {
    bridgeStatusLine = "Reconnecting...";
  }

  if (busyNotice.message) {
    bridgeStatusLine = busyNotice.message;
  } else if (transientUiNotice?.message) {
    bridgeStatusLine = transientUiNotice.message;
  }

  const marqueeBusy = (
    busyNotice.tone === "busy" ||
    bridgeState.streamState !== "live" ||
    selectionPendingSnapshot ||
    (liveThread?.id && roomHydrating)
  );
  marqueeTicker.setText(marqueeBusy ? formatBusyMarqueeText(bridgeStatusLine) : bridgeStatusLine);
  nodes.marquee.classList.toggle("is-busy", marqueeBusy);
  if (transientUiNotice?.message) {
    setUiStatus(transientUiNotice.message, transientUiNotice.tone);
  } else {
    setUiStatus("", "neutral");
  }
  setPanelHidden(nodes.statusPanel, !(operatorDiagnostics.length > 0 || Boolean(transientUiNotice?.message)));

  const blockedReason = composeBlockedReason();
  const controlBlocked = sessionBlockedReason();
  const sendBlocked = sendBlockedReason(liveThread?.id || "");
  const canCompose = !blockedReason;
  const canControl = !controlBlocked;
  nodes.replyToggleButton.disabled = !canCompose || uiState.selecting || isDictating;
  nodes.replyToggleButton.textContent = isSendingReply ? "Sending..." : isComposerOpen ? "Hide reply" : "Reply";

  if (nodes.controlToggleButton) {
    nodes.controlToggleButton.disabled = !canControl || isSendingReply || uiState.selecting || uiState.controlling || isDictating;
    nodes.controlToggleButton.textContent = uiState.controlling
      ? controlActive
        ? "Releasing..."
        : "Taking..."
      : controlActive
        ? "Release control"
        : "Take Control";
    nodes.controlToggleButton.classList.toggle("button-primary", !controlActive);
    nodes.controlToggleButton.classList.toggle("is-busy", uiState.controlling);
  }

  nodes.refreshButton.disabled =
    uiState.refreshing ||
    uiState.selecting ||
    uiState.booting ||
    isDictating;
  nodes.refreshButton.textContent = uiState.refreshing ? "Refreshing..." : "Refresh";
  nodes.refreshButton.classList.toggle("is-busy", uiState.refreshing);
  for (const button of nodes.companionSummonButtons) {
    const advisorId = button.dataset.companionSummon || "";
    const isBusy = manualAdvisorAction === advisorId;
    button.disabled = !liveThread?.id || uiState.selecting || isSendingReply || Boolean(companionActionState) || isBusy || isDictating;
    button.classList.toggle("is-busy", isBusy);
    button.textContent = isBusy ? "Waking..." : manualAdvisorLabel(advisorId);
  }

  nodes.replyText.disabled = Boolean(blockedReason) || isSendingReply || uiState.selecting || isDictating;
  nodes.replyImageInput.disabled = Boolean(blockedReason) || isSendingReply || uiState.selecting || isDictating;
  nodes.dictationButton.disabled = Boolean(blockedReason) || isSendingReply || uiState.selecting || uiState.controlling;
  const dictationUi = dictationUiModel();
  if (nodes.dictationButtonLabel) {
    nodes.dictationButtonLabel.textContent = dictationUi.label;
  }
  if (nodes.dictationButtonMeta) {
    nodes.dictationButtonMeta.textContent = dictationUi.meta;
  }
  if (nodes.dictationIndicatorText) {
    nodes.dictationIndicatorText.textContent = dictationUi.indicatorText;
  }
  setPanelHidden(nodes.dictationIndicator, !dictationUi.live);
  nodes.dictationButton.classList.toggle("is-busy", isDictating);
  nodes.dictationButton.classList.toggle("is-listening", isDictating);
  nodes.dictationButton.classList.toggle("is-armed", isDictationPressActive);
  nodes.dictationIndicator.classList.toggle("is-live", dictationUi.live);
  setPanelHidden(nodes.composerControlButton, true);
  nodes.composerControlButton.disabled = true;
  nodes.composerControlButton.textContent = "Take Control";
  nodes.composerControlButton.classList.remove("is-busy");
  const canQueue = canQueueReplyState({
    controlActive,
    hasDraftPayload,
    isControlling: uiState.controlling,
    isSelecting: uiState.selecting,
    isSendingReply,
    pendingInteraction: Boolean(currentLiveState?.pendingInteraction),
    queuedCount,
    sessionBlocked: Boolean(sessionBlockedReason()),
    threadBusy: busy,
    threadId: liveThread?.id || ""
  });
  nodes.sendReplyButton.disabled = !canSteerReplyState({
    blockedReason: sendBlocked,
    hasDraftPayload,
    isControlling: uiState.controlling,
    isDictating,
    isSelecting: uiState.selecting,
    isSendingReply,
    threadBusy: busy,
    threadId: liveThread?.id || ""
  });
  nodes.sendReplyButton.textContent = isSendingReply ? "Steering..." : "Steer Now";
  nodes.sendReplyButton.classList.toggle("is-busy", isSendingReply);
  nodes.queueReplyButton.disabled = !canQueue || isDictating;
  nodes.queueReplyButton.textContent = queuedCount > 0 ? `Queue (${queuedCount})` : "Queue";
  nodes.queueReplyButton.classList.remove("is-busy");
  nodes.clearQueueButton.disabled = !queuedCount || isSendingReply || uiState.selecting || uiState.controlling || isDictating;

  nodes.composerStatus.textContent = defaultComposerStatus({
    blockedReason,
    composerStatus,
    composerStatusTone,
    controlActive,
    hasDraftPayload,
    isSendingReply,
    queuedCount,
    threadBusy: busy
  });

  nodes.composerStatus.className = `composer-status ${
    composerStatusTone === "sending"
      ? "composer-status-sending"
      : composerStatusTone === "error"
        ? "composer-status-error"
        : composerStatusTone === "success"
          ? "composer-status-success"
          : ""
  }`;

  const shouldShowComposer = isComposerOpen;
  setPanelHidden(nodes.composerShell, !shouldShowComposer);
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
  const remoteCanRespond = hasRemoteControl(pending?.threadId || currentThreadId());

  if (!pending) {
    setPanelHidden(nodes.actionPanel, true);
    nodes.actionPanel.classList.remove("panel-pop");
    setPanelHidden(nodes.actionForm, true);
    setPanelHidden(nodes.actionButtons, false);
    setPanelHidden(nodes.approveSessionButton, true);
    setPanelHidden(nodes.actionControlGate, true);
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
    setPanelHidden(nodes.actionControlGate, true);
    clearHtmlRenderState(nodes.actionQuestions);
    return;
  }

  const isUserInput = pending.actionKind === "user_input";
  setPanelHidden(nodes.actionControlGate, remoteCanRespond);
  nodes.actionControlButton.disabled = uiState.controlling || uiState.selecting;
  nodes.actionControlButton.textContent = uiState.controlling ? "Taking..." : "Take Control";
  nodes.actionControlButton.classList.toggle("is-busy", uiState.controlling);
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

  nodes.actionSubmit.disabled = uiState.submittingAction || uiState.controlling || !remoteCanRespond;
  nodes.actionCancel.disabled = uiState.submittingAction || uiState.controlling || !remoteCanRespond;
  nodes.approveButton.disabled = uiState.submittingAction || uiState.controlling || !remoteCanRespond;
  nodes.approveSessionButton.disabled = uiState.submittingAction || uiState.controlling || !remoteCanRespond;
  nodes.declineButton.disabled = uiState.submittingAction || uiState.controlling || !remoteCanRespond;
  nodes.actionSubmit.classList.toggle("is-busy", uiState.submittingAction && isUserInput);
  nodes.approveButton.classList.toggle("is-busy", uiState.submittingAction && !isUserInput);
  nodes.approveSessionButton.classList.toggle("is-busy", uiState.submittingAction && !isUserInput);
  nodes.declineButton.classList.toggle("is-busy", uiState.submittingAction && !isUserInput);
}

function renderFeed() {
  resetCardHistoryIfNeeded();
  const entries = buildEntries();
  const transcriptHistoryState = historyStateForThread();
  if (
    stagedCompanionWakeKey &&
    !entries.some((entry) => entry.key === stagedCompanionWakeKey && entry?.participant?.role === "advisory")
  ) {
    clearStagedCompanionWakeKey();
  }
  renderFilterButtons(entries);
  const changesSection = feedFilters.changes ? renderChangesSection() : null;
  const items = [];
  const threadEntries = entries
    .filter((entry) => isConversationEntry(entry) && !isAdvisoryEntry(entry))
    .slice()
    .sort(compareEntryChronologyDesc);
  const unifiedEntries = entries.filter((entry) => entryMatchesFeedFilter(entry)).sort(compareEntryChronologyDesc);

  if (changesSection) {
    items.push({
      html: changesSection.html,
      key: "__changes__",
      signature: changesSection.signature
    });
  }

  if (unifiedEntries.length) {
    items.push(...renderFeedItems(unifiedEntries));
  }

  if (feedFilters.thread) {
    if (threadEntries.length || transcriptHistoryState?.loading || transcriptHistoryState?.hasMore !== false) {
      items.push({
        html: transcriptHistoryState?.loading
          ? '<div class="empty-card history-loading" data-history-sentinel="true">Loading older messages...</div>'
          : '<div class="history-sentinel" data-history-sentinel="true" aria-hidden="true"></div>',
        key: "__history__",
        signature: `history:${threadEntries.length}:${transcriptHistoryState?.loading ? "loading" : "idle"}:${transcriptHistoryState?.hasMore === false ? "done" : "more"}`
      });
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
  const topRenderableItem = items.find((item) => !String(item.key || "").startsWith("__history__")) || null;
  return {
    topKey: topRenderableItem?.key || null
  };
}

function render() {
  if (!currentSnapshot && !currentLiveState) {
    return;
  }

  const previousScrollY = window.scrollY || window.pageYOffset || 0;
  const wasNearTop = previousScrollY <= FEED_STICKY_TOP_THRESHOLD_PX;

  queuedRepliesForThread();
  renderSidebar();
  renderStatuses();
  renderActionPanel();
  renderAttachments();
  renderQueuePanel();
  const { topKey } = renderFeed();
  setPanelHidden(nodes.composerForm, !isComposerOpen);

  if (pendingScrollToLatest) {
    pendingScrollToLatest = false;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  } else if (wasNearTop && topKey && topKey !== lastRenderedFeedTopKey) {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  lastRenderedFeedTopKey = topKey;
}

async function loadOlderTranscriptHistory() {
  const threadId = currentThreadId();
  const historyState = historyStateForThread(threadId);
  if (!threadId || !historyState || historyState.loading || historyState.hasMore === false) {
    return null;
  }

  const visibleCount = currentTranscriptEntries().length;
  if (!visibleCount) {
    return null;
  }

  const previousScrollY = window.scrollY || window.pageYOffset || 0;
  let loadedOlderItems = false;
  historyState.loading = true;
  render();

  try {
    const query = new URLSearchParams({
      limit: String(TRANSCRIPT_HISTORY_PAGE_SIZE),
      threadId
    });

    if (Number.isFinite(historyState.beforeIndex)) {
      query.set("beforeIndex", String(historyState.beforeIndex));
    } else {
      query.set("visibleCount", String(visibleCount));
    }

    const payload = await requestJson(`${transcriptHistoryUrl}?${query.toString()}`);
    historyState.items = mergeTranscriptEntries(payload.items || [], historyState.items || []);
    historyState.beforeIndex = Number.isFinite(payload.nextBeforeIndex) ? payload.nextBeforeIndex : null;
    historyState.hasMore = Boolean(payload.hasMore);
    loadedOlderItems = Array.isArray(payload.items) && payload.items.length > 0;
    historyState.awaitingUserScroll = loadedOlderItems;
    historyState.resumeAfterScrollY = null;
    return payload;
  } catch (error) {
    setTransientUiNotice(error.message || "Could not load older history.", "error", 2400);
    historyState.awaitingUserScroll = false;
    historyState.resumeAfterScrollY = null;
    return null;
  } finally {
    historyState.loading = false;
    render();
    if (loadedOlderItems) {
      window.requestAnimationFrame(() => {
        historyState.resumeAfterScrollY = previousScrollY + TRANSCRIPT_HISTORY_RESUME_SCROLL_DELTA_PX;
      });
    }
  }
}

function maybeLoadOlderTranscriptHistory() {
  const historyState = historyStateForThread();
  if (!historyState || historyState.loading || historyState.hasMore === false || !feedFilters.thread) {
    return;
  }

  const currentScrollY = window.scrollY || window.pageYOffset || 0;
  if (historyState.awaitingUserScroll) {
    if (!Number.isFinite(historyState.resumeAfterScrollY)) {
      return;
    }
    if (currentScrollY < historyState.resumeAfterScrollY) {
      return;
    }
    historyState.awaitingUserScroll = false;
    historyState.resumeAfterScrollY = null;
  }

  const sentinel = nodes.feed.querySelector('[data-history-sentinel="true"]');
  if (!sentinel) {
    return;
  }

  const rect = sentinel.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  if (rect.top <= viewportHeight + TRANSCRIPT_HISTORY_BOTTOM_THRESHOLD_PX) {
    void loadOlderTranscriptHistory();
  }
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
      nodes.remoteTarget.textContent = retrying ? "Waiting for session bridge..." : error.message;
      setComposerStatus(retrying ? "Waiting for session bridge..." : error.message, retrying ? "neutral" : "error");
      setUiStatus(retrying ? "Waiting for session bridge..." : error.message, retrying ? "busy" : "error");
    }
  },
  onBootstrapStart: () => {
    if (!currentLiveState) {
      uiState.booting = true;
    }
  },
  onBootstrapSuccess: ({ snapshot, live }) => {
    const previousState = currentLiveState;
    currentSnapshot = snapshot;
    currentLiveState = live;
    syncRoomStatusHold(previousState, currentLiveState);
    settleSelectionIntent();
    clearActionHandoff({ renderNow: false });
    uiState.booting = false;
    markLiveActivity();
    scheduleChangesRefresh({ immediate: true, showLoading: true });
    schedulePresenceSync(20, { force: true });
    scheduleQueueFlush(220);
  },
  onLive: (live) => {
    const previousState = currentLiveState;
    currentLiveState = live;
    syncRoomStatusHold(previousState, currentLiveState);
    settleSelectionIntent();
    handleControlEventNotice(previousState, currentLiveState);
    handleControlLeaseTransition(previousState, currentLiveState);
    if (currentLiveState?.pendingInteraction || !currentLiveState?.selectedThreadSnapshot?.thread?.activeTurnId) {
      clearActionHandoff({ renderNow: false });
    }
    markLiveActivity();
    scheduleChangesRefresh({ immediate: shouldImmediatelyRefreshChanges(previousState, currentLiveState) });
    schedulePresenceSync(90);
    scheduleQueueFlush(220);
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
      const previousState = currentLiveState;
      currentLiveState = payload.state;
      syncRoomStatusHold(previousState, currentLiveState);
      settleSelectionIntent();
      markLiveActivity();
      scheduleChangesRefresh({ immediate: true, showLoading: !background });
      schedulePresenceSync(90, { force: true });
      scheduleQueueFlush(220);
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
  const previousThreadId = currentThreadId();
  const previousDraft = nodes.replyText.value;
  selectionIntent = createSelectionIntent({
    cwd: body.cwd || currentLiveState?.selectedProjectCwd || "",
    projectLabel: projectLabel(body.cwd || currentLiveState?.selectedProjectCwd || ""),
    source: body.source || "remote",
    threadId: body.threadId || "",
    threadLabel:
      currentLiveState?.threads?.find((thread) => thread.id === body.threadId)?.channel?.channelSlug ||
      currentLiveState?.threads?.find((thread) => thread.id === body.threadId)?.name ||
      ""
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
    const nextThreadId = currentThreadId();
    if (previousThreadId !== nextThreadId) {
      persistDraft(previousThreadId, previousDraft);
      resetComposerDraft({ keepStatus: true });
      clearStagedCompanionWakeKey();
      restoreDraft(nextThreadId, { force: true });
      setComposerStatus("Target changed. Re-open reply to send.");
    }
    markLiveActivity();
    scheduleChangesRefresh({ immediate: true, showLoading: true });
    schedulePresenceSync(40, { force: true });
    render();
    scheduleQueueFlush(220);
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

async function submitControl(action) {
  uiState.controlling = true;
  render();

  try {
    const payload = await requestJson(controlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        clientId: surfaceAuthClientId,
        source: "remote",
        threadId: currentThreadId()
      })
    });
    currentLiveState = payload.state;
    markLiveActivity();
    schedulePresenceSync(30, { force: true });
    render();
    if (action === "claim") {
      scheduleQueueFlush(180);
    }
  } catch (error) {
    adoptErrorState(error);
    throw error;
  } finally {
    uiState.controlling = false;
    render();
  }
}

async function renewControlLeaseInBackground() {
  if (controlRenewPromise || uiState.controlling || uiState.selecting || uiState.booting || !shouldRenewControlLease()) {
    return controlRenewPromise;
  }

  controlRenewPromise = requestJson(controlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "renew",
      clientId: surfaceAuthClientId,
      source: "remote",
      threadId: currentThreadId()
    })
  })
    .then((payload) => {
      currentLiveState = payload.state;
      markLiveActivity();
      return payload;
    })
    .catch(async () => {
      await refreshLiveState({ background: true });
      return null;
    })
    .finally(() => {
      controlRenewPromise = null;
    });

  return controlRenewPromise;
}

async function submitInteraction(body) {
  const previousPending = currentLiveState?.pendingInteraction || null;
  uiState.submittingAction = body?.action || "submit";
  render();

  try {
    const payload = await requestJson(interactionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        source: "remote"
      })
    });
    currentLiveState = payload.state;
    if (!currentLiveState?.pendingInteraction) {
      beginActionHandoff(previousPending, currentLiveState, body?.action || "submit");
    }
    markLiveActivity();
    scheduleChangesRefresh({ immediate: true });
    schedulePresenceSync(30, { force: true });
    render();
    scheduleQueueFlush(220);
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

async function summonAdvisor(advisorId = "") {
  const normalizedAdvisorId = String(advisorId || "").trim().toLowerCase();
  if (!normalizedAdvisorId || manualAdvisorAction || companionActionState) {
    return;
  }

  manualAdvisorAction = normalizedAdvisorId;
  render();

  try {
    const payload = await requestJson(companionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "summon",
        advisorId: normalizedAdvisorId,
        threadId: currentThreadId()
      })
    });
    currentLiveState = payload.state || currentLiveState;
    markLiveActivity();
    schedulePresenceSync(30, { force: true });
    setTransientUiNotice(payload.message || "Shared note ready.", "success", 2400);
    render();
  } catch (error) {
    adoptErrorState(error);
    throw error;
  } finally {
    manualAdvisorAction = "";
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

function scheduleQueueFlush(delayMs = 320) {
  if (queueFlushTimer) {
    window.clearTimeout(queueFlushTimer);
  }

  queueFlushTimer = window.setTimeout(() => {
    queueFlushTimer = null;
    void flushQueuedReplies({ background: true });
  }, delayMs);
}

function queueLiveReply({ rawText, attachments }) {
  const threadId = currentThreadId();
  const reply = createQueuedReply({
    attachments,
    queuedAt: new Date().toISOString(),
    rawText,
    sequence: queuedReplySequence += 1,
    threadId
  });

  const nextQueue = [...queuedRepliesForThread(threadId), reply];
  setQueuedRepliesForThread(threadId, nextQueue);
  nodes.replyText.value = "";
  clearPersistedDraft(threadId);
  clearStagedCompanionWakeKey();
  clearAttachments();
  isComposerOpen = true;
  setComposerStatus(
    hasRemoteControl(threadId)
      ? nextQueue.length === 1
        ? "Queued. Waiting for idle."
        : `Queued. ${nextQueue.length} waiting for idle.`
      : threadBusy()
        ? nextQueue.length === 1
          ? "Queued locally. Waiting for idle."
          : `Queued locally. ${nextQueue.length} waiting for idle.`
        : nextQueue.length === 1
          ? "Queued locally. Sending soon."
          : `Queued locally. ${nextQueue.length} sending soon.`,
    "success"
  );
  render();
  focusReplyTextAtEnd();
  scheduleQueueFlush();
}

async function dispatchLiveReply({ rawText, attachments, threadId = currentThreadId(), preserveDraftOnError = false } = {}) {
  const text = rawText.trim();
  if (!text && !attachments.length) {
    throw new Error("Reply cannot be empty.");
  }

  const blockedReason = sendBlockedReason(threadId);
  if (blockedReason) {
    throw new Error(blockedReason);
  }

  const liveThread = currentLiveState?.selectedThreadSnapshot?.thread;
  if (!liveThread?.id || liveThread.id !== threadId) {
    throw new Error("Selected session changed before send.");
  }

  const composerWasOpen = isComposerOpen;
  const previousDraft = nodes.replyText.value;
  const previousAttachments = pendingAttachments.slice();

  isSendingReply = true;
  pendingOutgoingText = text;
  pendingOutgoingAttachments = cloneReplyAttachments(attachments);
  isComposerOpen = composerWasOpen;
  nodes.replyText.value = "";
  clearPersistedDraft(threadId);
  clearStagedCompanionWakeKey();
  clearAttachments();
  setComposerStatus("Sending...", "sending");
  render();

  try {
    const payload = await requestJson(turnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachments: attachments.map((attachment) => ({
          dataUrl: attachment.dataUrl,
          name: attachment.name,
          type: attachment.type
        })),
        clientId: surfaceAuthClientId,
        source: "remote",
        threadId: liveThread.id,
        text
      })
    });

    currentLiveState = {
      ...(currentLiveState || {}),
      selectedProjectCwd: payload.thread?.cwd || currentLiveState?.selectedProjectCwd || "",
      selectedThreadId: payload.thread?.id || currentLiveState?.selectedThreadId || "",
      selectedThreadSnapshot: payload.snapshot || currentLiveState?.selectedThreadSnapshot || null,
      status: {
        ...(currentLiveState?.status || {}),
        lastWrite: {
          at: new Date().toISOString(),
          source: "remote",
          threadId: payload.thread?.id || liveThread.id,
          turnId: payload.turn?.id || null,
          turnStatus: payload.turn?.status || null
        },
        lastWriteForSelection: {
          at: new Date().toISOString(),
          source: "remote",
          threadId: payload.thread?.id || liveThread.id,
          turnId: payload.turn?.id || null,
          turnStatus: payload.turn?.status || null
        },
        writeLock: null
      }
    };
    markLiveActivity();
    scheduleChangesRefresh({ immediate: true });
    pendingOutgoingText = "";
    pendingOutgoingAttachments = [];
    isSendingReply = false;
    isComposerOpen = composerWasOpen;
    setComposerStatus(
      "Sent here. Dextunnel is current. Desktop Codex may still need a quit and reopen to show this turn.",
      "success"
    );
    render();
    if (composerWasOpen) {
      focusReplyTextAtEnd();
    }
    scheduleQueueFlush(650);
    window.setTimeout(() => {
      if (!isSendingReply && composerStatus === "Sent.") {
        setComposerStatus("Ready");
        render();
      }
    }, 1600);
  } catch (error) {
    adoptErrorState(error);
    isSendingReply = false;
    pendingOutgoingText = "";
    pendingOutgoingAttachments = [];
    if (preserveDraftOnError) {
      nodes.replyText.value = previousDraft;
      pendingAttachments = previousAttachments;
      persistDraft(threadId, previousDraft);
      renderAttachments();
      isComposerOpen = composerWasOpen;
    }
    setComposerStatus(error.message, "error");
    render();
    throw error;
  }
}

async function flushQueuedReplies({ background = false } = {}) {
  if (queueFlushPromise || isSendingReply) {
    return queueFlushPromise;
  }

  const threadId = currentThreadId();
  const queue = queuedRepliesForThread(threadId);
  if (
    !shouldFlushQueuedReplies({
      blockedReason: sendBlockedReason(threadId),
      hasInFlight: Boolean(queueFlushPromise),
      isSendingReply,
      queuedCount: queue.length,
      threadBusy: threadBusy(),
      threadId
    })
  ) {
    return null;
  }

  const blockedReason = sendBlockedReason(threadId);
  if (controlClaimRequired(blockedReason)) {
    try {
      await submitControl("claim");
    } catch (error) {
      if (!background) {
        throw error;
      }
      setComposerStatus(error.message, "error");
      render();
      return null;
    }
  }

  const [nextReply, ...remaining] = queue;
  setQueuedRepliesForThread(threadId, remaining);
  render();

  queueFlushPromise = dispatchLiveReply({
    attachments: nextReply.attachments,
    rawText: nextReply.text,
    threadId
  })
    .then((payload) => {
      if (background && payload) {
        const remainingCount = queuedRepliesForThread(threadId).length;
        setTransientUiNotice(
          remainingCount ? `Queued send complete. ${remainingCount} left.` : "Queued send complete.",
          "success",
          2200
        );
      }
      return payload;
    })
    .catch((error) => {
      setQueuedRepliesForThread(threadId, [nextReply, ...queuedRepliesForThread(threadId)]);
      setComposerStatus(error.message, "error");
      render();
      if (!background) {
        throw error;
      }
      return null;
    })
    .finally(() => {
      queueFlushPromise = null;
      if (queuedRepliesForThread(threadId).length) {
        scheduleQueueFlush(900);
      }
    });

  return queueFlushPromise;
}

async function submitLiveReply({ rawText, attachments }) {
  const text = rawText.trim();
  if (!text && !attachments.length) {
    throw new Error("Reply cannot be empty.");
  }

  const blockedReason = sendBlockedReason();
  if (blockedReason && !controlClaimRequired(blockedReason)) {
    throw new Error(blockedReason);
  }

  if (controlClaimRequired(blockedReason)) {
    setComposerStatus("Taking control...", "sending");
    render();
    await submitControl("claim");
  }

  if (threadBusy()) {
    throw new Error("Codex is busy. Use Queue.");
  }

  try {
    await dispatchLiveReply({
      attachments,
      rawText: text,
      preserveDraftOnError: true
    });
  } catch (error) {
    if (/already has an active turn|Write already in progress|running/i.test(String(error.message || ""))) {
      queueLiveReply({ attachments, rawText: text });
      setComposerStatus("Thread turned busy. Reply queued.", "success");
      render();
      return;
    }

    throw error;
  }
}

nodes.sidebarToggleButton?.addEventListener("click", () => {
  markUserIntent();
  setSidebarExpanded(!sidebarExpanded);
  render();
});

nodes.sidebarOverlay?.addEventListener("click", () => {
  if (!isMobileSidebarLayout() || !sidebarExpanded) {
    return;
  }
  markUserIntent();
  setSidebarExpanded(false);
  render();
});

window.addEventListener("resize", () => {
  const mobileLayout = isMobileSidebarLayout();
  if (mobileLayout === lastSidebarMobileLayout) {
    return;
  }

  lastSidebarMobileLayout = mobileLayout;
  if (mobileLayout) {
    setSidebarExpanded(false, { persist: false });
  } else {
    setSidebarExpanded(surfaceViewState.loadSidebarMode() !== "collapsed", { persist: false });
  }
  render();
});

nodes.sidebarGroups?.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-sidebar-thread-id]");
  if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) {
    return;
  }

  const threadId = String(target.dataset.sidebarThreadId || "").trim();
  const cwd = String(target.dataset.sidebarCwd || "").trim();
  if (!threadId) {
    return;
  }

  markUserIntent();
  try {
    await submitSelection({
      clientId: surfaceAuthClientId,
      cwd,
      source: "remote",
      threadId
    });
    if (isMobileSidebarLayout()) {
      setSidebarExpanded(false);
      render();
    }
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

for (const button of nodes.filterButtons) {
  button.addEventListener("click", () => {
    markUserIntent();
    const filter = button.dataset.filter;

    feedFilters[filter] = !feedFilters[filter];
    surfaceViewState.saveFilters(feedFilters);
    render();
  });
}

nodes.expandAllButton?.addEventListener("click", () => {
  markUserIntent();
  expandAllCards = !expandAllCards;
  if (!expandAllCards) {
    expandedEntryKeys.clear();
  }
  surfaceViewState.saveExpansionMode(currentThreadIdLabel() || "none", expandAllCards ? "expanded" : "compact");
  render();
});

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
    surfaceViewState.saveExpandedSections(currentThreadIdLabel() || "none", [...expandedFeedSections]);
  },
  true
);

for (const button of nodes.companionSummonButtons) {
  button.addEventListener("click", async () => {
    markUserIntent();
    try {
      await summonAdvisor(button.dataset.companionSummon || "");
    } catch (error) {
      setComposerStatus(error.message, "error");
      render();
    }
  });
}

nodes.replyToggleButton.addEventListener("click", () => {
  markUserIntent();
  if (composeBlockedReason() || isSendingReply) {
    return;
  }

  isComposerOpen = !isComposerOpen;
  if (isComposerOpen && !hasRemoteControl()) {
    setComposerStatus("Steer now takes control. Queue stays local.");
  } else if (isComposerOpen) {
    setComposerStatus("Ready");
  } else {
    clearStagedCompanionWakeKey();
    setComposerStatus("Ready");
  }
  render();

  if (isComposerOpen) {
    focusReplyTextAtEnd();
  }
});

nodes.composerCloseButton.addEventListener("click", () => {
  markUserIntent();
  if (isSendingReply) {
    return;
  }

  if (isDictating) {
    stopDictation();
    return;
  }

  isComposerOpen = false;
  clearStagedCompanionWakeKey();
  setComposerStatus("Ready");
  render();
});

nodes.dictationButton.addEventListener("click", () => {
  markUserIntent();
  if (suppressNextDictationClick) {
    suppressNextDictationClick = false;
    return;
  }
  try {
    if (isDictating) {
      stopDictation();
      return;
    }

    startDictation();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

if (hasPointerSupport()) {
  nodes.dictationButton.addEventListener("pointerdown", (event) => {
    markUserIntent();
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (nodes.dictationButton.disabled) {
      return;
    }
    try {
      nodes.dictationButton.setPointerCapture?.(event.pointerId);
    } catch {}
    beginPressDictation(event.pointerId);
  });

  const releasePointerDictation = (event) => {
    endPressDictation(event.pointerId);
  };

  nodes.dictationButton.addEventListener("pointerup", releasePointerDictation);
  nodes.dictationButton.addEventListener("pointercancel", releasePointerDictation);
  nodes.dictationButton.addEventListener("lostpointercapture", () => {
    endPressDictation();
  });
}

nodes.controlToggleButton.addEventListener("click", async () => {
  markUserIntent();
  const threadId = currentThreadId();
  if (!threadId || sessionBlockedReason() || isSendingReply || uiState.controlling) {
    return;
  }

  try {
    const nextAction = hasRemoteControl(threadId) ? "release" : "claim";
    await submitControl(nextAction);
    const message = nextAction === "claim" ? "Remote control active." : "Remote control released.";
    setComposerStatus(message, "success");
    render();
    scheduleComposerStatusReset();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

nodes.actionControlButton.addEventListener("click", async () => {
  markUserIntent();
  if (!currentThreadId() || uiState.controlling || sessionBlockedReason()) {
    return;
  }

  try {
    await submitControl("claim");
    setComposerStatus("Remote control active.", "success");
    render();
    scheduleComposerStatusReset();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

nodes.composerControlButton.addEventListener("click", async () => {
  markUserIntent();
  if (!currentThreadId() || uiState.controlling || sessionBlockedReason()) {
    return;
  }

  try {
    await submitControl("claim");
    setComposerStatus("Remote control active.", "success");
    render();
    scheduleComposerStatusReset();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

nodes.replyImageInput.addEventListener("change", async (event) => {
  markUserIntent();
  const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    return;
  }

  try {
    const nextAttachments = await Promise.all(
      files.map(async (file, index) => ({
        dataUrl: await fileToDataUrl(file),
        id: `${file.name}-${file.size}-${Date.now()}-${index}`,
        name: file.name,
        size: file.size,
        type: file.type || "image/png"
      }))
    );

    pendingAttachments = [...pendingAttachments, ...nextAttachments].slice(0, 4);
    nodes.replyImageInput.value = "";
    renderAttachments();
    if (!isComposerOpen && !isSendingReply) {
      isComposerOpen = true;
    }
    setComposerStatus("Image attached.");
    render();
  } catch (error) {
    nodes.replyImageInput.value = "";
    setComposerStatus(error.message, "error");
    render();
  }
});

nodes.replyText.addEventListener("input", () => {
  if (isDictating) {
    return;
  }
  persistDraft();
  if (!isComposerOpen && !isSendingReply) {
    isComposerOpen = true;
  }
  render();
});

nodes.attachmentList.addEventListener("click", (event) => {
  markUserIntent();
  const button = event.target.closest("[data-attachment-id]");
  if (!button || isSendingReply) {
    return;
  }

  pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== button.dataset.attachmentId);
  renderAttachments();
  setComposerStatus(pendingAttachments.length ? "Image removed." : "Ready");
  render();
});

nodes.feed.addEventListener("click", async (event) => {
  markUserIntent();
  const actionButton = event.target.closest("[data-companion-action]");
  if (actionButton) {
    event.preventDefault();
    event.stopPropagation();
    if (actionButton.dataset.companionAction === "stage") {
      const key = actionButton.dataset.wakeKey;
      const entry = buildEntries().find((candidate) => candidate.key === key);
      if (entry) {
        stageCompanionPrompt(entry);
      }
      return;
    }

    try {
      await submitCompanionAction({
        action: actionButton.dataset.companionAction,
        advisorId: actionButton.dataset.advisorId,
        wakeKey: actionButton.dataset.wakeKey
      });
    } catch (error) {
      setComposerStatus(error.message, "error");
      render();
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

nodes.refreshButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await refreshLiveState();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

nodes.approveButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await submitInteraction({ action: "approve" });
    setComposerStatus("Approved.", "success");
    render();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

nodes.approveSessionButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await submitInteraction({ action: "session" });
    setComposerStatus("Approved for session.", "success");
    render();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

nodes.declineButton.addEventListener("click", async () => {
  markUserIntent();
  try {
    await submitInteraction({ action: "decline" });
    setComposerStatus("Declined.", "success");
    render();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
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
    setComposerStatus("Input sent.", "success");
    render();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

nodes.actionCancel.addEventListener("click", async () => {
  markUserIntent();
  try {
    await submitInteraction({ action: "cancel" });
    setComposerStatus("Cancelled.", "success");
    render();
  } catch (error) {
    setComposerStatus(error.message, "error");
    render();
  }
});

nodes.composerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  markUserIntent();
  try {
    await submitLiveReply({
      rawText: nodes.replyText.value,
      attachments: pendingAttachments.slice()
    });
  } catch {
    // Status is already rendered by submitLiveReply.
  }
});

nodes.queueReplyButton.addEventListener("click", () => {
  markUserIntent();
  if (!currentThreadId() || composeBlockedReason() || isSendingReply || uiState.selecting || uiState.controlling) {
    return;
  }

  const rawText = nodes.replyText.value;
  const attachments = pendingAttachments.slice();
  if (!rawText.trim() && !attachments.length) {
    setComposerStatus("Write something before queueing.", "error");
    render();
    return;
  }

  queueLiveReply({ attachments, rawText });
});

nodes.clearQueueButton.addEventListener("click", () => {
  markUserIntent();
  const threadId = currentThreadId();
  if (!threadId || !queuedRepliesForThread(threadId).length) {
    return;
  }

  clearQueuedReplies(threadId);
  setComposerStatus("Queue cleared.", "success");
  render();
});

nodes.composerQueueList.addEventListener("click", (event) => {
  markUserIntent();
  const button = event.target.closest("[data-queued-reply-id]");
  if (!button) {
    return;
  }

  const threadId = currentThreadId();
  const replyId = button.dataset.queuedReplyId || "";
  if (!threadId || !replyId) {
    return;
  }

  removeQueuedReply(threadId, replyId);
  const remaining = queuedRepliesForThread(threadId).length;
  setComposerStatus(remaining ? `Removed from queue. ${remaining} left.` : "Removed from queue.", "success");
  render();
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && isDictating) {
    stopDictation();
  }
});

window.setInterval(() => {
  if (!shouldRenewControlLease()) {
    return;
  }

  void renewControlLeaseInBackground();
}, CONTROL_RENEW_INTERVAL_MS);

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
  if (document.visibilityState === "hidden") {
    persistDraft();
  }
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

window.addEventListener(
  "scroll",
  () => {
    maybeLoadOlderTranscriptHistory();
  },
  { passive: true }
);

window.addEventListener("pagehide", () => {
  persistDraft();
  sendDetachPresence();
  closeStream();
});

window.setInterval(() => {
  if (!currentLiveState || bridgeState.streamState !== "live") {
    return;
  }

  void syncPresence();
}, PRESENCE_HEARTBEAT_INTERVAL_MS);

ensureStream();
void bootstrapLiveState();
