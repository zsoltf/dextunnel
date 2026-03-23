export function createInteractionStateService({
  appServerState,
  liveState,
  nowIso = () => new Date().toISOString(),
  trimInteractionText = (value, maxLength = 72) => String(value || "").trim().slice(0, maxLength)
} = {}) {
  function interactionKindLabel(request) {
    switch (request.method) {
      case "item/commandExecution/requestApproval":
        return "Command";
      case "item/fileChange/requestApproval":
        return "File change";
      case "item/permissions/requestApproval":
        return "Permissions";
      case "item/tool/requestUserInput":
        return "Tool input";
      default:
        return "Action";
    }
  }

  function interactionRequestSummary(request) {
    switch (request.method) {
      case "item/commandExecution/requestApproval":
        return trimInteractionText(request.params?.command || "command approval", 52);
      case "item/fileChange/requestApproval":
        return trimInteractionText(request.params?.changes?.[0]?.path || "file change", 52);
      case "item/permissions/requestApproval":
        return "permissions";
      case "item/tool/requestUserInput": {
        const firstQuestion = request.params?.questions?.[0] || null;
        const questionText = `${firstQuestion?.question || ""}`;
        const matchedTool = questionText.match(/tool "([^"]+)"/i);
        if (matchedTool?.[1]) {
          return `${matchedTool[1]} approval`;
        }
        return trimInteractionText(firstQuestion?.header || firstQuestion?.question || "user input", 52);
      }
      default:
        return trimInteractionText(request.method || "interaction", 52);
    }
  }

  function interactionRetryContinuation(summary, action = null) {
    switch (action) {
      case "cancel":
        return `Codex asked for ${summary} again after the last step was canceled.`;
      case "decline":
        return `Codex asked for ${summary} again after the last step was declined.`;
      case "session":
        return `Codex asked for ${summary} again after session access was allowed.`;
      case "submit":
        return `Codex asked for ${summary} again after the last input was submitted.`;
      default:
        return `Codex asked for ${summary} again in the same turn.`;
    }
  }

  function describeInteractionFlow({
    actionKind = "",
    flowStep = 1,
    previousAction = null,
    previousSummary = "",
    retryAttempt = 1,
    summary = ""
  } = {}) {
    const flowLabel = flowStep > 1 ? `Step ${flowStep} of the live flow` : "Waiting on this turn";

    if (retryAttempt > 1) {
      return {
        flowContinuation: interactionRetryContinuation(summary, previousAction),
        flowLabel
      };
    }

    if (flowStep > 1) {
      if (previousSummary && previousSummary !== summary) {
        return {
          flowContinuation: `Last step settled: ${previousSummary}. Now waiting on ${summary}.`,
          flowLabel
        };
      }

      return {
        flowContinuation: summary
          ? `Continuing ${summary} in the same turn.`
          : "Continuing the same live flow.",
        flowLabel
      };
    }

    return {
      flowContinuation:
        actionKind === "user_input"
          ? "Codex needs this input before the turn can continue."
          : "Codex needs this decision before the turn can continue.",
      flowLabel
    };
  }

  function beginInteractionFlow(request) {
    const threadId = request.params?.threadId || null;
    const turnId = request.params?.turnId || null;
    const summary = interactionRequestSummary(request);
    const previous = liveState.interactionFlow;
    const sameTurn = Boolean(
      previous &&
        previous.threadId &&
        previous.threadId === threadId &&
        previous.turnId &&
        previous.turnId === turnId
    );
    const sameRequest = Boolean(sameTurn && previous.method === request.method && previous.summary === summary);
    const lastInteraction =
      appServerState.lastInteraction?.threadId === threadId && appServerState.lastInteraction?.turnId === turnId
        ? appServerState.lastInteraction
        : null;
    const step = sameTurn ? (previous.step || 0) + 1 : 1;
    const retryAttempt = sameRequest ? (previous.retryAttempt || 1) + 1 : 1;

    liveState.interactionFlow = {
      method: request.method,
      previousAction: sameRequest ? lastInteraction?.action || null : null,
      previousSummary: sameTurn && !sameRequest ? previous.summary || "" : sameTurn ? previous.previousSummary || "" : "",
      requestId: request.requestId,
      retryAttempt,
      startedAt: sameTurn ? previous.startedAt : nowIso(),
      step,
      summary,
      threadId,
      turnId
    };

    return liveState.interactionFlow;
  }

  function clearInteractionFlow({ threadId = null } = {}) {
    if (!threadId || liveState.interactionFlow?.threadId === threadId) {
      liveState.interactionFlow = null;
    }
  }

  function summarizeNotificationInteraction(pending, request) {
    return {
      at: nowIso(),
      detail: pending?.detail || "",
      flowContinuation: pending?.flowContinuation || "",
      flowLabel: pending?.flowLabel || "",
      flowStep: pending?.flowStep || null,
      itemId: request.params?.itemId || null,
      kind: pending?.kind || "interaction",
      kindLabel: pending?.kindLabel || null,
      requestId: request.requestId,
      retryAttempt: pending?.retryAttempt || 1,
      summary: pending?.summary || interactionRequestSummary(request),
      source: "app-server",
      status: "pending",
      threadId: pending?.threadId || request.params?.threadId || null,
      turnId: pending?.turnId || request.params?.turnId || null
    };
  }

  function mapPendingInteraction(request, flow = null) {
    const flowStep = flow?.step || 1;
    const kindLabel = interactionKindLabel(request);
    const summary = interactionRequestSummary(request);
    const retryAttempt = flow?.retryAttempt || 1;
    const { flowLabel, flowContinuation } = describeInteractionFlow({
      actionKind:
        request.method === "item/tool/requestUserInput"
          ? "user_input"
          : "approval",
      flowStep,
      previousAction: flow?.previousAction || null,
      previousSummary: flow?.previousSummary || "",
      retryAttempt,
      summary
    });

    switch (request.method) {
      case "item/commandExecution/requestApproval":
        return {
          actionKind: "approval",
          approveLabel: "Approve once",
          availableDecisions: request.params.availableDecisions || ["accept", "decline", "cancel"],
          canApproveForSession: (request.params.availableDecisions || []).includes("acceptForSession"),
          command: request.params.command || null,
          cwd: request.params.cwd || null,
          declineLabel: "Decline",
          detail:
            request.params.reason ||
            request.params.command ||
            "Codex requested permission to execute a command.",
          flowContinuation,
          flowLabel,
          flowStep,
          itemId: request.params.itemId || null,
          kind: "command",
          kindLabel,
          method: request.method,
          requestId: request.requestId,
          retryAttempt,
          sessionActionLabel: "Approve for session",
          summary,
          threadId: request.params.threadId,
          title: request.params.command || "Approve command",
          turnId: request.params.turnId
        };
      case "item/fileChange/requestApproval":
        return {
          actionKind: "approval",
          approveLabel: "Approve",
          availableDecisions: ["accept", "decline", "cancel"],
          canApproveForSession: false,
          declineLabel: "Decline",
          detail: request.params.reason || "Codex requested approval for a file change.",
          flowContinuation,
          flowLabel,
          flowStep,
          itemId: request.params.itemId || null,
          kind: "file_change",
          kindLabel,
          method: request.method,
          requestId: request.requestId,
          retryAttempt,
          sessionActionLabel: "",
          summary,
          threadId: request.params.threadId,
          title: "Approve file change",
          turnId: request.params.turnId
        };
      case "item/permissions/requestApproval":
        return {
          actionKind: "approval",
          approveLabel: "Allow turn",
          canApproveForSession: true,
          declineLabel: "Decline",
          detail: request.params.reason || "Codex requested additional permissions.",
          flowContinuation,
          flowLabel,
          flowStep,
          itemId: request.params.itemId || null,
          kind: "permissions",
          kindLabel,
          method: request.method,
          permissions: request.params.permissions,
          requestId: request.requestId,
          retryAttempt,
          sessionActionLabel: "Allow session",
          summary,
          threadId: request.params.threadId,
          title: "Grant permissions",
          turnId: request.params.turnId
        };
      case "item/tool/requestUserInput":
        return {
          actionKind: "user_input",
          detail: trimInteractionText(
            request.params.questions?.[0]?.question ||
              request.params.questions?.[0]?.header ||
              "Codex needs user input to continue.",
            180
          ),
          flowContinuation,
          flowLabel,
          flowStep,
          itemId: request.params.itemId || null,
          kind: "tool_input",
          kindLabel,
          method: request.method,
          questions: request.params.questions || [],
          requestId: request.requestId,
          retryAttempt,
          submitLabel: "Submit",
          summary,
          threadId: request.params.threadId,
          title: "Provide input",
          turnId: request.params.turnId
        };
      default:
        return {
          actionKind: "unsupported",
          detail: `Unsupported server request: ${request.method}`,
          flowContinuation,
          flowLabel,
          flowStep,
          kind: "unsupported",
          kindLabel,
          method: request.method,
          requestId: request.requestId,
          retryAttempt,
          summary,
          title: "Unsupported request"
        };
    }
  }

  function getScopedEvent(event) {
    if (!event) {
      return null;
    }

    const selectedThreadId = liveState.selectedThreadId || null;
    if (!selectedThreadId || !event.threadId) {
      return selectedThreadId ? null : event;
    }

    return event.threadId === selectedThreadId ? event : null;
  }

  function getLastInteractionForSelectedThread() {
    return getScopedEvent(appServerState.lastInteraction || null);
  }

  function getPendingInteractionForSelectedThread() {
    const pending = liveState.pendingInteraction || null;
    if (!pending) {
      return null;
    }

    const selectedThreadId = liveState.selectedThreadId || null;
    if (!selectedThreadId || !pending.threadId) {
      return pending;
    }

    return pending.threadId === selectedThreadId ? pending : null;
  }

  function getLastWriteForSelectedThread() {
    return getScopedEvent(appServerState.lastWrite || null);
  }

  function getLastControlEventForSelectedThread() {
    return getScopedEvent(appServerState.lastControlEvent || null);
  }

  function getLastSelectionEventForSelectedThread() {
    return getScopedEvent(appServerState.lastSelectionEvent || null);
  }

  function getLastSurfaceEventForSelectedThread() {
    return getScopedEvent(appServerState.lastSurfaceEvent || null);
  }

  return {
    beginInteractionFlow,
    clearInteractionFlow,
    describeInteractionFlow,
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
  };
}
