import { randomUUID } from "node:crypto";

export const STRATEGIES = {
  "semantic-dom": {
    id: "semantic-dom",
    label: "Semantic DOM adapter",
    summary: "Reads the transcript semantically and can send structured input back.",
    capabilities: [
      "semantic_read",
      "semantic_write",
      "approval_actions",
      "focus_input",
      "window_stream"
    ]
  },
  "paste-submit": {
    id: "paste-submit",
    label: "Focus + paste + submit",
    summary: "Keeps semantic read when possible, but writes back via focused paste and submit.",
    capabilities: [
      "semantic_read",
      "approval_actions",
      "focus_input",
      "paste_submit",
      "window_stream"
    ]
  },
  "video-only": {
    id: "video-only",
    label: "Window stream fallback",
    summary: "No semantic adapter is available, so the companion relies on preview plus generic input.",
    capabilities: [
      "window_stream",
      "generic_input_only"
    ]
  }
};

export const WINDOW_PROFILES = {
  "phone-portrait": {
    id: "phone-portrait",
    label: "Phone portrait",
    size: "430 x 932",
    summary: "Tight text density and large touch targets."
  },
  "ipad-portrait": {
    id: "ipad-portrait",
    label: "iPad portrait",
    size: "820 x 1180",
    summary: "Single-column transcript with large approval affordances."
  },
  "ipad-landscape": {
    id: "ipad-landscape",
    label: "iPad landscape",
    size: "1180 x 820",
    summary: "Two-panel view with transcript and live preview."
  },
  desktop: {
    id: "desktop",
    label: "Desktop",
    size: "1440 x 960",
    summary: "Reference host layout."
  }
};

function now() {
  return new Date().toISOString();
}

function createMessage(role, kind, text) {
  return {
    id: randomUUID(),
    role,
    kind,
    text,
    timestamp: now()
  };
}

function clampList(list, limit = 18) {
  return list.slice(Math.max(0, list.length - limit));
}

function createBaseState() {
  return {
    session: {
      id: "codex-session-alpha",
      title: "Codex session / couch control spike",
      appName: "Codex",
      status: "live",
      strategyId: "semantic-dom",
      windowProfileId: "ipad-landscape",
      transportLabel: "Local SSE bridge",
      transportNext: "WebRTC data channel and preview stream",
      previewMode: "mock-preview",
      lastUpdatedAt: now()
    },
    transcript: [
      createMessage(
        "system",
        "status",
        "Host bridge online. This MVP is local-only and uses a mock Codex adapter."
      ),
      createMessage(
        "assistant",
        "message",
        "Remote companion layout is active. Use the host console to switch between semantic mode and fallback modes."
      ),
      createMessage(
        "tool",
        "status",
        "Pending real integrations: ScreenCaptureKit, WebRTC, Accessibility, and Codex-specific adapters."
      )
    ],
    pendingApproval: null,
    commandLog: [],
    draftInput: ""
  };
}

function decorateState(state) {
  const strategy = STRATEGIES[state.session.strategyId];
  const windowProfile = WINDOW_PROFILES[state.session.windowProfileId];

  return {
    ...structuredClone(state),
    session: {
      ...structuredClone(state.session),
      strategy,
      windowProfile
    }
  };
}

export function createSessionStore() {
  const listeners = new Set();
  const state = createBaseState();

  function emit() {
    state.session.lastUpdatedAt = now();
    const snapshot = decorateState(state);
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function addTranscript(role, kind, text) {
    state.transcript = clampList([...state.transcript, createMessage(role, kind, text)], 36);
  }

  function logCommand(source, type, summary) {
    state.commandLog = clampList(
      [
        ...state.commandLog,
        {
          id: randomUUID(),
          source,
          type,
          summary,
          timestamp: now()
        }
      ],
      14
    );
  }

  function setStrategy(strategyId, source = "host") {
    const strategy = STRATEGIES[strategyId];
    if (!strategy) {
      throw new Error(`Unknown strategy: ${strategyId}`);
    }

    state.session.strategyId = strategyId;
    logCommand(source, "set_strategy", `Switched adapter to ${strategy.label}.`);
    addTranscript("system", "status", `Adapter switched to ${strategy.label}. ${strategy.summary}`);
  }

  function setWindowProfile(windowProfileId, source = "host") {
    const profile = WINDOW_PROFILES[windowProfileId];
    if (!profile) {
      throw new Error(`Unknown window profile: ${windowProfileId}`);
    }

    state.session.windowProfileId = windowProfileId;
    logCommand(source, "set_window_profile", `Window preset changed to ${profile.label}.`);
    addTranscript(
      "system",
      "status",
      `Window preset is now ${profile.label} (${profile.size}). ${profile.summary}`
    );
  }

  function queueApproval(source = "host") {
    if (state.pendingApproval) {
      logCommand(source, "queue_approval", "Approval was already pending.");
      return;
    }

    state.pendingApproval = {
      id: randomUUID(),
      title: "Approve next remote action",
      detail: "Companion-mode approval added by the host console."
    };
    logCommand(source, "queue_approval", "Queued approval request.");
    addTranscript("tool", "status", "Host queued an approval card for the remote companion.");
  }

  function clearApproval(source = "host") {
    state.pendingApproval = null;
    logCommand(source, "clear_approval", "Cleared pending approval.");
    addTranscript("tool", "status", "Pending approval cleared.");
  }

  function approve(source = "remote") {
    if (!state.pendingApproval) {
      logCommand(source, "approve", "No pending approval to accept.");
      addTranscript("tool", "status", "Approve tapped, but nothing was waiting.");
      return;
    }

    logCommand(source, "approve", `Approved "${state.pendingApproval.title}".`);
    addTranscript(
      "tool",
      "status",
      `Approval accepted from ${source}. In a real adapter this would release the gated action.`
    );
    state.pendingApproval = null;
  }

  function sendText(text, source = "remote") {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Reply text cannot be empty.");
    }

    state.draftInput = "";
    logCommand(source, "send_text", `Sent reply: ${trimmed}`);
    addTranscript("user", "message", trimmed);
    state.session.status = "running";
  }

  function submit(source = "remote") {
    logCommand(
      source,
      "submit",
      `Submit requested via ${STRATEGIES[state.session.strategyId].label}.`
    );
    addTranscript(
      "system",
      "status",
      `Submit routed through ${STRATEGIES[state.session.strategyId].label}.`
    );
    state.session.status = "running";
  }

  function interrupt(source = "remote") {
    logCommand(source, "interrupt", "Interrupt requested.");
    addTranscript("system", "status", "Interrupt intent received. Host would attempt to stop the active turn.");
    state.session.status = "live";
  }

  function focusInput(source = "remote") {
    logCommand(source, "focus_input", "Focus input requested.");
    addTranscript(
      "system",
      "status",
      `Focus input requested from ${source}. In fallback mode this would activate the target window first.`
    );
  }

  function setDraft(text, source = "remote") {
    state.draftInput = text;
    logCommand(source, "set_draft", "Updated remote draft.");
  }

  function simulateAssistantTurn(source = "host", text) {
    const message =
      text?.trim() ||
      "Mock adapter follow-up: the next real spike should test whether Codex can expose semantic transcript access without degrading the normal desktop experience.";

    logCommand(source, "simulate_assistant_turn", "Added mock assistant turn.");
    addTranscript("assistant", "message", message);
    state.session.status = "live";
  }

  function applyCommand(command) {
    const source = command.source || "host";

    switch (command.type) {
      case "set_strategy":
        setStrategy(command.strategyId, source);
        break;
      case "set_window_profile":
        setWindowProfile(command.windowProfileId, source);
        break;
      case "queue_approval":
        queueApproval(source);
        break;
      case "clear_approval":
        clearApproval(source);
        break;
      case "approve":
        approve(source);
        break;
      case "send_text":
        sendText(command.text || "", source);
        break;
      case "submit":
        submit(source);
        break;
      case "interrupt":
        interrupt(source);
        break;
      case "focus_input":
        focusInput(source);
        break;
      case "set_draft":
        setDraft(command.text || "", source);
        break;
      case "simulate_assistant_turn":
        simulateAssistantTurn(source, command.text);
        break;
      default:
        throw new Error(`Unknown command type: ${command.type}`);
    }

    emit();
    return getState();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => {
      listeners.delete(listener);
    };
  }

  function getState() {
    return decorateState(state);
  }

  function publishTranscript(role, kind, text) {
    addTranscript(role, kind, text);
    emit();
    return getState();
  }

  return {
    applyCommand,
    publishTranscript,
    getState,
    subscribe
  };
}
