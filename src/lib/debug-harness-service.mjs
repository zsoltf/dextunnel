export function createDebugHarnessService({
  ADVISORY_PARTICIPANT_IDS = [],
  appServerState,
  broadcast = () => {},
  buildLivePayload = () => ({}),
  getDefaultCwd = () => process.cwd(),
  liveState,
  nowIso = () => new Date().toISOString(),
  nowMs = () => Date.now(),
  queueCompanionWakeup = () => {}
} = {}) {
  function createDebugPendingInteraction(kind) {
    const thread = liveState.selectedThreadSnapshot?.thread || null;
    const threadId = thread?.id || liveState.selectedThreadId || "debug-thread";
    const cwd = thread?.cwd || liveState.selectedProjectCwd || getDefaultCwd();
    const requestId = `debug-${kind}-${nowMs()}`;

    switch (kind) {
      case "command":
        return {
          actionKind: "approval",
          approveLabel: "Approve once",
          availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
          canApproveForSession: true,
          command: "npm test",
          cwd,
          debug: true,
          declineLabel: "Decline",
          detail: "Local-only harness request for command approval.",
          kind: "command",
          method: "item/commandExecution/requestApproval",
          requestId,
          sessionActionLabel: "Approve for session",
          threadId,
          title: "Debug command approval"
        };
      case "file_change":
        return {
          actionKind: "approval",
          approveLabel: "Approve",
          availableDecisions: ["accept", "decline", "cancel"],
          canApproveForSession: false,
          debug: true,
          declineLabel: "Decline",
          detail: "Local-only harness request for file-change approval.",
          kind: "file_change",
          method: "item/fileChange/requestApproval",
          requestId,
          sessionActionLabel: "",
          threadId,
          title: "Debug file change"
        };
      case "permissions":
        return {
          actionKind: "approval",
          approveLabel: "Allow turn",
          canApproveForSession: true,
          debug: true,
          declineLabel: "Decline",
          detail: "Local-only harness request for permissions approval.",
          kind: "permissions",
          method: "item/permissions/requestApproval",
          permissions: {
            filesystem: "workspace-write",
            network: true
          },
          requestId,
          sessionActionLabel: "Allow session",
          threadId,
          title: "Debug permissions request"
        };
      case "user_input":
        return {
          actionKind: "user_input",
          debug: true,
          detail: "Local-only harness request for tool user input.",
          kind: "tool_input",
          method: "item/tool/requestUserInput",
          questions: [
            {
              header: "Deploy note",
              id: "deploy_note",
              isOther: true,
              options: [{ label: "Ship it" }, { label: "Hold for review" }],
              question: "What note should be attached to this run?"
            },
            {
              header: "Token",
              id: "token",
              isSecret: true,
              question: "Optional secret token"
            }
          ],
          requestId,
          submitLabel: "Submit",
          threadId,
          title: "Debug user input"
        };
      default:
        throw new Error(`Unsupported debug interaction kind: ${kind}`);
    }
  }

  function setDebugPendingInteraction(kind) {
    if (liveState.pendingInteraction) {
      throw new Error("Resolve the pending interaction before creating another one.");
    }

    liveState.pendingInteraction = createDebugPendingInteraction(kind);
    liveState.lastError = null;
    appServerState.lastInteraction = {
      at: nowIso(),
      kind,
      source: "debug-harness",
      status: "pending",
      threadId: liveState.pendingInteraction.threadId
    };
    broadcast("live", buildLivePayload());
    return buildLivePayload();
  }

  function clearDebugPendingInteraction() {
    if (liveState.pendingInteraction?.debug) {
      liveState.pendingInteraction = null;
      liveState.lastError = null;
      appServerState.lastInteraction = {
        at: nowIso(),
        kind: "debug-clear",
        source: "debug-harness",
        status: "cleared",
        threadId: liveState.selectedThreadId || null
      };
      broadcast("live", buildLivePayload());
    }

    return buildLivePayload();
  }

  function setDebugCompanionWakeup({ advisorId = "", threadId = null, wakeKind = "summary" } = {}) {
    const nextThreadId = threadId || liveState.selectedThreadId || liveState.selectedThreadSnapshot?.thread?.id || null;
    if (!nextThreadId) {
      throw new Error("Select a live session before creating a companion wakeup.");
    }

    const normalizedWakeKind = String(wakeKind || "").trim().toLowerCase() === "review" ? "review" : "summary";
    const normalizedAdvisorId = String(advisorId || "").trim().toLowerCase();
    const nextAdvisorId =
      normalizedAdvisorId || (normalizedWakeKind === "review" ? "oracle" : "gemini");
    if (!ADVISORY_PARTICIPANT_IDS.includes(nextAdvisorId)) {
      throw new Error(`Unsupported advisory participant: ${advisorId}`);
    }

    queueCompanionWakeup({
      advisorId: nextAdvisorId,
      text:
        normalizedWakeKind === "review"
          ? "Review ready: local-only wakeup harness seeded a review notice for this channel."
          : "Summary ready: local-only wakeup harness seeded a summary notice for this channel.",
      threadId: nextThreadId,
      turnId: null,
      wakeKey: `debug-${nextAdvisorId}-${normalizedWakeKind}:${nowMs()}`,
      wakeKind: normalizedWakeKind
    });
    return buildLivePayload();
  }

  return {
    clearDebugPendingInteraction,
    createDebugPendingInteraction,
    setDebugCompanionWakeup,
    setDebugPendingInteraction
  };
}
