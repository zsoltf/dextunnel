export function createInteractionResolutionService({
  appServerState,
  broadcast = () => {},
  buildLivePayload = () => ({}),
  controlLeaseTtlMs,
  ensureRemoteControlLease = () => {},
  getWatcherController = () => null,
  hasWatcherController = () => false,
  liveState,
  maybeWakeCompanionForInteractionResolution = () => {},
  nowIso = () => new Date().toISOString(),
  setControlLease = () => {}
} = {}) {
  function normalizeUserInputAnswers(questions, answers = {}) {
    const payload = {};

    for (const question of questions || []) {
      const raw = answers[question.id];
      const list = Array.isArray(raw)
        ? raw.map((value) => String(value).trim()).filter(Boolean)
        : raw == null
          ? []
          : [String(raw).trim()].filter(Boolean);

      if (list.length > 0) {
        payload[question.id] = { answers: list };
      }
    }

    return payload;
  }

  function getCommandDecision(action, pending) {
    const decisions = pending.availableDecisions || [];

    if (action === "decline") {
      return decisions.includes("decline") ? "decline" : "cancel";
    }

    if (action === "session" && decisions.includes("acceptForSession")) {
      return "acceptForSession";
    }

    return "accept";
  }

  async function resolvePendingInteraction(body) {
    const pending = liveState.pendingInteraction;
    if (!pending) {
      throw new Error("No pending interaction.");
    }

    const authorityClientId = body.authorityClientId || null;
    if (body.source === "remote" && pending.threadId) {
      ensureRemoteControlLease(pending.threadId, "remote", authorityClientId);
    }

    const activeWatcherController = getWatcherController();

    if (!pending.debug && !hasWatcherController()) {
      throw new Error("Live watcher is not connected.");
    }

    if (pending.debug) {
      appServerState.lastInteraction = {
        action: body.action || (pending.actionKind === "user_input" ? "submit" : "approve"),
        answers:
          pending.actionKind === "user_input"
            ? normalizeUserInputAnswers(pending.questions, body.answers || {})
            : null,
        at: nowIso(),
        flowContinuation: pending.flowContinuation || "",
        flowLabel: pending.flowLabel || "",
        flowStep: pending.flowStep || null,
        kind: pending.kind,
        kindLabel: pending.kindLabel || null,
        retryAttempt: pending.retryAttempt || 1,
        summary: pending.summary || null,
        source: "debug-harness",
        status: "resolved",
        threadId: pending.threadId || null
      };
      liveState.pendingInteraction = null;
      liveState.lastError = null;
      maybeWakeCompanionForInteractionResolution({
        interaction: appServerState.lastInteraction,
        threadId: pending.threadId || null
      });
      broadcast("live", buildLivePayload());
      return;
    }

    switch (pending.method) {
      case "item/commandExecution/requestApproval":
        activeWatcherController.respond(pending.requestId, {
          decision: getCommandDecision(body.action || "approve", pending)
        });
        break;
      case "item/fileChange/requestApproval":
        activeWatcherController.respond(pending.requestId, {
          decision: body.action === "decline" ? "decline" : "accept"
        });
        break;
      case "item/permissions/requestApproval":
        if ((body.action || "approve") !== "approve") {
          if (body.action === "session") {
            activeWatcherController.respond(pending.requestId, {
              permissions: pending.permissions || {},
              scope: "session"
            });
            break;
          }

          activeWatcherController.respondError(pending.requestId, "Permission request declined by the companion.");
          break;
        }

        activeWatcherController.respond(pending.requestId, {
          permissions: pending.permissions || {},
          scope: body.scope === "session" ? "session" : "turn"
        });
        break;
      case "item/tool/requestUserInput": {
        if ((body.action || "submit") !== "submit") {
          activeWatcherController.respondError(pending.requestId, "User input cancelled by the companion.");
          break;
        }

        const answers = normalizeUserInputAnswers(pending.questions, body.answers || {});
        activeWatcherController.respond(pending.requestId, {
          answers
        });
        break;
      }
      default:
        activeWatcherController.respondError(pending.requestId, "Unsupported interaction from Dextunnel.");
        break;
    }

    appServerState.lastInteraction = {
      action: body.action || (pending.actionKind === "user_input" ? "submit" : "approve"),
      answers:
        pending.actionKind === "user_input"
          ? normalizeUserInputAnswers(pending.questions, body.answers || {})
          : null,
      at: nowIso(),
      flowContinuation: pending.flowContinuation || "",
      flowLabel: pending.flowLabel || "",
      flowStep: pending.flowStep || null,
      itemId: pending.itemId || null,
      kind: pending.kind,
      kindLabel: pending.kindLabel || null,
      requestId: pending.requestId,
      retryAttempt: pending.retryAttempt || 1,
      summary: pending.summary || null,
      source: "app-server",
      status: "responded",
      threadId: pending.threadId || null,
      turnId: pending.turnId || null
    };
    if (body.source === "remote" && pending.threadId) {
      setControlLease({
        clientId: authorityClientId,
        owner: "remote",
        reason: "interaction",
        source: "remote",
        threadId: pending.threadId,
        ttlMs: controlLeaseTtlMs
      });
    }
    liveState.pendingInteraction = null;
    liveState.lastError = null;
    broadcast("live", buildLivePayload());
  }

  return {
    getCommandDecision,
    normalizeUserInputAnswers,
    resolvePendingInteraction
  };
}
