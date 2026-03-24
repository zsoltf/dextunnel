export async function handleBridgeApiRequest({ req, res, url, deps }) {
  const {
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
    buildSelectedThreadSnapshot,
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
    hasWatcherController = () => false,
    interruptSelectedThread,
    issueSurfaceBootstrap,
    liveState,
    mergeSelectedThreadSnapshot = (_previousSnapshot, nextSnapshot) => nextSnapshot,
    cwd,
    mapThreadToCompanionSnapshot,
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
    scheduleSnapshotRefresh = () => {},
    scheduleControlLeaseExpiry,
    sendJson,
    setDebugCompanionWakeup,
    setDebugPendingInteraction,
    setSelection,
    store,
    streamState,
    summonCompanionWakeup,
    updateAgentRoom,
    invalidateRepoChangesCache,
    loadTranscriptHistoryPage
  } = deps;

  function summarizeResponseThread(thread) {
    if (!thread) {
      return null;
    }

    return {
      activeTurnId: thread.activeTurnId || null,
      activeTurnStatus: thread.activeTurnStatus || null,
      cwd: thread.cwd || null,
      id: thread.id || null,
      lastTurnId: thread.lastTurnId || null,
      lastTurnStatus: thread.lastTurnStatus || null,
      name: thread.name || null,
      path: thread.path || null,
      preview: thread.preview || null,
      source: thread.source || null,
      status: thread.status || null,
      tokenUsage: thread.tokenUsage || null,
      updatedAt: thread.updatedAt || null
    };
  }

  function summarizeResponseTurn(turn) {
    if (!turn) {
      return null;
    }

    return {
      id: turn.id || null,
      startedAt: turn.startedAt || null,
      status: turn.status || null,
      updatedAt: turn.updatedAt || null
    };
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/codex-app-server/bootstrap") {
      const surface = String(url.searchParams.get("surface") || "remote").trim().toLowerCase();
      const pathname = surface === "host" ? "/host.html" : "/remote.html";

      try {
        if (
          !canServeSurfaceBootstrap({
            exposeHostSurface,
            localAddress: req.socket?.localAddress || "",
            pathname,
            remoteAddress: req.socket?.remoteAddress || ""
          })
        ) {
          sendJson(res, 403, {
            error: "Host surface bootstrap is restricted to loopback unless DEXTUNNEL_EXPOSE_HOST_SURFACE is enabled."
          });
          return true;
        }

        sendJson(res, 200, issueSurfaceBootstrap(surface));
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), { error: error.message });
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      requireSurfaceCapability(req, url, "read_room");
      sendJson(res, 200, store.getState());
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/preflight") {
      try {
        const payload = await buildInstallPreflight({
          codexAppServer,
          cwd,
          runtimeConfig: deps.runtimeConfig,
          warmup: url.searchParams.get("warmup") !== "0"
        });
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, errorStatusCode(error, 500), { error: error.message });
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/codex-app-server/live-state") {
      requireSurfaceCapability(req, url, "read_room");
      sendJson(res, 200, buildLivePayload());
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/codex-app-server/transcript-history") {
      try {
        requireSurfaceCapability(req, url, "read_room");
        const threadId = url.searchParams.get("threadId") || liveState.selectedThreadId || null;
        if (!threadId) {
          sendJson(res, 400, { error: "threadId is required" });
          return true;
        }

        const page = await loadTranscriptHistoryPage({
          beforeIndex: url.searchParams.get("beforeIndex"),
          limit: url.searchParams.get("limit"),
          threadId,
          visibleCount: url.searchParams.get("visibleCount")
        });
        sendJson(res, 200, page);
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/codex-app-server/status") {
      requireSurfaceCapability(req, url, "read_room");
      sendJson(res, 200, buildBridgeStatus());
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/codex-app-server/changes") {
      try {
        requireSurfaceCapability(req, url, "read_room");
        const targetCwd = url.searchParams.get("cwd") || liveState.selectedProjectCwd || cwd;
        const threadId = url.searchParams.get("threadId") || liveState.selectedThreadId || null;
        const selectedThread = liveState.selectedThreadSnapshot?.thread || null;
        const liveTurnPayload =
          threadId &&
          liveState.turnDiff?.threadId === threadId &&
          liveState.turnDiff?.diff
            ? buildLiveTurnChanges({
                cwd: targetCwd,
                diff: liveState.turnDiff.diff,
                threadId,
                turnId: liveState.turnDiff.turnId || null
              })
            : null;
        const threadPath =
          threadId && selectedThread?.id === threadId
            ? selectedThread.path || null
            : null;
        const payload =
          liveTurnPayload && liveTurnPayload.items.length
            ? liveTurnPayload
            : await getCachedRepoChanges(targetCwd, { threadPath });
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, errorStatusCode(error, 500), { error: error.message });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/refresh") {
      try {
        requireSurfaceCapability(req, url, "refresh_room");
        const includeThreads = url.searchParams.get("threads") !== "0";
        const payload = await refreshLiveState({ includeThreads });
        sendJson(res, 200, { ok: true, state: payload });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 500), { error: error.message, status: buildBridgeStatus() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/reconnect") {
      try {
        requireSurfaceCapability(req, url, "refresh_room");
        const includeThreads = url.searchParams.get("threads") !== "0";
        await restartWatcher();
        const payload = await refreshLiveState({ includeThreads });
        sendJson(res, 200, { ok: true, state: payload });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 500), { error: error.message, status: buildBridgeStatus() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/open-in-codex") {
      try {
        requireSurfaceCapability(req, url, "open_in_codex");
        const body = await readJsonBody(req);
        const threadId = body.threadId || liveState.selectedThreadId || null;
        if (!threadId) {
          sendJson(res, 400, { error: "threadId is required" });
          return true;
        }

        const payload = await openThreadInCodex(threadId);
        sendJson(res, 200, {
          ok: true,
          ...payload,
          message:
            "Revealed this thread in Codex. Quit and reopen the Codex app manually to see new messages generated here."
        });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 500), { error: error.message, status: buildBridgeStatus() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/selection") {
      try {
        const access = requireSurfaceCapability(req, url, "select_room");
        const body = await readJsonBody(req);
        const payload = await setSelection({
          clientId: accessClientId(access),
          cwd: body.cwd || null,
          source: access.surface,
          threadId: body.threadId || null
        });
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, errorStatusCode(error, 409), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/presence") {
      try {
        const access = requireSurfaceCapability(req, url, "sync_presence");
        const body = await readJsonBody(req);
        const changed = applySurfacePresenceUpdate(
          {
            ...body,
            clientId: accessClientId(access),
            surface: access.surface
          },
          {
            now: Date.now(),
            selectedThreadId: liveState.selectedThreadId || ""
          }
        );

        if (changed) {
          broadcast("live", buildLivePayload());
        }
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/control") {
      try {
        const body = await readJsonBody(req);
        const threadId = body.threadId || liveState.selectedThreadId || null;
        const action = body.action || "claim";
        const access = resolveSurfaceAccess(req, url);
        if (!access) {
          throw Object.assign(new Error("Dextunnel surface access is missing or expired."), {
            statusCode: 403
          });
        }
        const clientId = accessClientId(access);
        const existingLease = getControlLeaseForThread(threadId);
        const requiredCapability =
          action === "release" && access.surface === "host"
            ? "release_remote_control"
            : "control_remote";
        if (!access.capabilities.includes(requiredCapability)) {
          throw Object.assign(
            new Error(`${access.surface} surface is not allowed to ${requiredCapability.replaceAll("_", " ")}.`),
            { statusCode: 403 }
          );
        }

        const result = applyLiveControlAction({
          action,
          clientId,
          existingLease,
          now: Date.now(),
          owner: access.surface,
          reason: action === "claim" ? body.reason || "compose" : body.reason || null,
          source: access.surface,
          threadId,
          ttlMs: CONTROL_LEASE_TTL_MS
        });

        liveState.controlLease = result.lease;
        scheduleControlLeaseExpiry();
        if (result.recordEvent && result.event) {
          recordControlEvent(result.event);
        }

        liveState.lastError = null;
        broadcast("live", buildLivePayload());
        sendJson(res, 200, {
          ok: true,
          action,
          state: buildLivePayload()
        });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/interaction") {
      try {
        const body = await readJsonBody(req);
        const access = requireSurfaceCapability(req, url, "respond_interaction");
        await resolvePendingInteraction({
          ...body,
          authorityClientId: accessClientId(access),
          source: access.surface
        });
        sendJson(res, 200, { ok: true, state: buildLivePayload() });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/companion") {
      try {
        requireSurfaceCapability(req, url, "use_companion");
        const body = await readJsonBody(req);
        const threadId = body.threadId || liveState.selectedThreadId || null;
        const result =
          body.action === "summon"
            ? summonCompanionWakeup({
                advisorId: body.advisorId || "",
                threadId
              })
            : applyCompanionWakeupAction({
                action: body.action,
                threadId,
                wakeKey: body.wakeKey
              });
        broadcast("live", buildLivePayload());
        sendJson(res, 200, { ok: true, message: result.message, state: buildLivePayload() });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/agent-room") {
      try {
        requireSurfaceCapability(req, url, "use_agent_room");
        const body = await readJsonBody(req);
        const threadId = body.threadId || liveState.selectedThreadId || null;
        const result = await updateAgentRoom({
          action: body.action || "",
          memberIds: Array.isArray(body.memberIds) ? body.memberIds : null,
          text: body.text || "",
          threadId
        });
        broadcast("live", buildLivePayload());
        sendJson(res, 200, { ok: true, message: result.message, state: buildLivePayload() });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/debug/live-interaction") {
      if (!devToolsEnabled) {
        sendJson(res, 404, { error: "Not found" });
        return true;
      }
      try {
        requireSurfaceCapability(req, url, "debug_tools");
        const body = await readJsonBody(req);
        const payload =
          body.action === "clear"
            ? clearDebugPendingInteraction()
            : setDebugPendingInteraction(body.kind || "");
        sendJson(res, 200, { ok: true, state: payload });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/debug/companion-wakeup") {
      if (!devToolsEnabled) {
        sendJson(res, 404, { error: "Not found" });
        return true;
      }
      try {
        requireSurfaceCapability(req, url, "debug_tools");
        const body = await readJsonBody(req);
        const payload = setDebugCompanionWakeup({
          advisorId: body.advisorId || "",
          threadId: body.threadId || liveState.selectedThreadId || null,
          wakeKind: body.wakeKind || "summary"
        });
        broadcast("live", payload);
        sendJson(res, 200, { ok: true, state: payload });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/interrupt") {
      try {
        requireSurfaceCapability(req, url, "control_remote");
        const payload = await interruptSelectedThread();
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, 400, { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/codex-app-server/threads") {
      try {
        requireSurfaceCapability(req, url, "read_room");
        await refreshThreads({ broadcastUpdate: false });
        sendJson(res, 200, {
          cwd: null,
          data: liveState.threads
        });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 500), { error: error.message, status: buildBridgeStatus() });
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/codex-app-server/thread") {
      try {
        requireSurfaceCapability(req, url, "read_room");
        const threadId = url.searchParams.get("threadId");
        const limit = Number(url.searchParams.get("limit") || "40");

        if (!threadId) {
          sendJson(res, 400, { error: "threadId is required" });
          return true;
        }

        const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : null;
        const thread = await codexAppServer.readThread(threadId, false);
        const snapshot = thread
          ? decorateSnapshot(
              await buildSelectedThreadSnapshot(thread, {
                limit: normalizedLimit
              })
            )
          : null;

        sendJson(res, 200, {
          threadId,
          found: Boolean(thread),
          snapshot
        });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 500), { error: error.message, status: buildBridgeStatus() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/thread") {
      try {
        const access = requireSurfaceCapability(req, url, "select_room");
        const body = await readJsonBody(req);
        const payload = await createThreadSelection({
          clientId: accessClientId(access),
          cwd: body.cwd || null,
          source: access.surface
        });
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, errorStatusCode(error, 409), { error: error.message, state: buildLivePayload() });
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/codex-app-server/latest-thread") {
      try {
        requireSurfaceCapability(req, url, "read_room");
        const targetCwd = url.searchParams.get("cwd") || cwd;
        const limit = Number(url.searchParams.get("limit") || "40");
        const thread = await codexAppServer.getLatestThreadForCwd(targetCwd);
        sendJson(res, 200, {
          cwd: targetCwd,
          found: Boolean(thread),
          snapshot: thread
            ? decorateSnapshot(
                mapThreadToCompanionSnapshot(thread, {
                  limit: Number.isFinite(limit) && limit > 0 ? limit : null
                })
              )
            : null
        });
      } catch (error) {
        sendJson(res, errorStatusCode(error, 500), { error: error.message, status: buildBridgeStatus() });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/codex-app-server/turn") {
      let body = {};
      let targetThreadId = null;
      let selectedThreadIdBeforeSend = liveState.selectedThreadId || null;
      try {
        body = await readJsonBody(req);
        const access = requireSurfaceCapability(req, url, "send_turn");
        targetThreadId = body.threadId || liveState.selectedThreadId || null;
        const targetCwd = body.cwd || liveState.selectedProjectCwd || cwd;
        const attachments = await persistImageAttachments(body.attachments);

        if (!targetThreadId && body.createThreadIfMissing === false) {
          throw new Error("No selected live Codex thread is available.");
        }

        if (
          liveState.writeLock &&
          liveState.writeLock.threadId === targetThreadId &&
          liveState.writeLock.status === "pending"
        ) {
          throw new Error("A live send is already in progress for this session.");
        }

        if (liveState.pendingInteraction) {
          throw new Error("Resolve the pending interaction before sending another message.");
        }

        if (targetThreadId && access.capabilities.includes("control_remote")) {
          ensureRemoteControlLease(targetThreadId, access.surface, accessClientId(access));
        }

        liveState.writeLock = {
          at: nowIso(),
          preview:
            String(body.text || "").slice(0, 140) ||
            (attachments.length
              ? `[${attachments.length} image attachment${attachments.length === 1 ? "" : "s"}]`
              : ""),
          source: access.surface,
          status: "pending",
          threadId: targetThreadId
        };
        broadcast("live", buildLivePayload());

        const result = await codexAppServer.sendText({
          threadId: targetThreadId,
          cwd: targetCwd,
          text: body.text || "",
          attachments,
          createThreadIfMissing: body.createThreadIfMissing !== false,
          waitForCompletion: false,
          timeoutMs: Number(body.timeoutMs || 45000)
        });

        rememberTurnOrigin(result.thread.id, result.turn.id, access.surface);
        invalidateRepoChangesCache({
          cwd: result.thread.cwd || targetCwd,
          threadPath: result.thread.path || ""
        });
        const selectionStillTargetsSendThread =
          !liveState.selectedThreadId ||
          liveState.selectedThreadId === targetThreadId ||
          liveState.selectedThreadId === result.thread.id;

        if (selectionStillTargetsSendThread) {
          liveState.selectedThreadId = result.thread.id;
          liveState.selectedProjectCwd = result.thread.cwd || targetCwd;
          liveState.selectedThreadSnapshot = mergeSelectedThreadSnapshot(
            liveState.selectedThreadSnapshot,
            result.snapshot
          );
        }
        liveState.lastSyncAt = nowIso();
        liveState.writeLock = null;
        appServerState.lastWrite = {
          at: nowIso(),
          mode: result.mode,
          source: access.surface,
          threadId: result.thread.id,
          turnId: result.turn.id,
          turnStatus: result.turn.status
        };
        const responseSnapshot =
          selectionStillTargetsSendThread && liveState.selectedThreadSnapshot
            ? liveState.selectedThreadSnapshot
            : result.snapshot;
        const decoratedSnapshot = decorateSnapshot(responseSnapshot);
        broadcast("live", buildLivePayload());
        sendJson(res, 200, {
          ok: true,
          mode: result.mode,
          snapshot: decoratedSnapshot,
          thread: summarizeResponseThread(decoratedSnapshot?.thread || result.thread),
          turn: summarizeResponseTurn(result.turn)
        });
        void (async () => {
          try {
            await refreshThreads({ broadcastUpdate: false });
            const shouldRestartWatcher =
              liveState.selectedThreadId !== selectedThreadIdBeforeSend ||
              (selectionStillTargetsSendThread && liveState.selectedThreadId !== result.thread.id) ||
              !liveState.watcherConnected ||
              !hasWatcherController();
            if (shouldRestartWatcher) {
              await restartWatcher();
            } else {
              scheduleSnapshotRefresh(120);
            }
            broadcast("live", buildLivePayload());
          } catch (error) {
            liveState.lastError = error.message;
            broadcast("live", buildLivePayload());
          }
        })();
      } catch (error) {
        liveState.writeLock = null;
        appServerState.lastWrite = {
          at: nowIso(),
          error: error.message,
          source: "remote",
          threadId: targetThreadId || null
        };
        const state = buildLivePayload();
        const statusCode = errorStatusCode(
          error,
          /already in progress|pending interaction|holds control|take control/i.test(String(error.message || ""))
            ? 409
            : 500
        );
        broadcast("live", state);
        sendJson(res, statusCode, {
          error: error.message,
          state,
          status: state.status
        });
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/stream") {
      requireSurfaceCapability(req, url, "read_room");
      streamState(req, res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/commands") {
      if (!devToolsEnabled || !mockAdapter) {
        sendJson(res, 404, { error: "Not found" });
        return true;
      }
      try {
        requireSurfaceCapability(req, url, "debug_tools");
        const command = await readJsonBody(req);
        const snapshot = store.applyCommand(command);
        mockAdapter.scheduleFollowUp(command);
        sendJson(res, 200, snapshot);
      } catch (error) {
        sendJson(res, errorStatusCode(error, 400), {
          error: error.message
        });
      }
      return true;
    }

    return false;
  } catch (error) {
    sendJson(res, errorStatusCode(error, 500), { error: error.message, state: buildLivePayload() });
    return true;
  }
}
