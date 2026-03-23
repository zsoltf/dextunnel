import {
  planBootstrapRetry,
  planStreamRecovery,
  reconnectStreamState
} from "./live-bridge-retry-state.js";

export function createLiveBridgeLifecycleState({
  bootstrapRetryBaseMs,
  streamRecoveryBaseMs
} = {}) {
  return {
    bootstrapPromise: null,
    bootstrapRetryBackoffMs: bootstrapRetryBaseMs,
    bootstrapRetryTimer: null,
    refreshAfterStreamReconnect: false,
    refreshPromise: null,
    stream: null,
    streamRecoveryBackoffMs: streamRecoveryBaseMs,
    streamRecoveryTimer: null,
    streamState: "connecting"
  };
}

export function createLiveBridgeLifecycle({
  state,
  bootstrapRetry,
  streamRecovery,
  createEventSource,
  createTimeout = (callback, delay) => window.setTimeout(callback, delay),
  clearCreatedTimeout = (timer) => window.clearTimeout(timer),
  getHasLiveState,
  getVisible,
  onBootstrapError,
  onBootstrapStart,
  onBootstrapSuccess,
  onLive,
  onRender = () => {},
  onSnapshot,
  onStreamError,
  onStreamOpen,
  requestBootstrap,
  requestRefresh,
  streamUrl
}) {
  if (!state) {
    throw new Error("createLiveBridgeLifecycle requires a mutable state object.");
  }

  const lifecycle = {
    bootstrap,
    closeStream,
    ensureStream,
    resetBootstrapRetry,
    resetStreamRecovery,
    resumeVisible,
    refresh
  };

  function resetStreamRecovery() {
    if (state.streamRecoveryTimer) {
      clearCreatedTimeout(state.streamRecoveryTimer);
      state.streamRecoveryTimer = null;
    }
    state.streamRecoveryBackoffMs = streamRecovery.baseMs;
  }

  function resetBootstrapRetry() {
    if (state.bootstrapRetryTimer) {
      clearCreatedTimeout(state.bootstrapRetryTimer);
      state.bootstrapRetryTimer = null;
    }
    state.bootstrapRetryBackoffMs = bootstrapRetry.baseMs;
  }

  function closeStream() {
    if (!state.stream) {
      return;
    }

    state.stream.close();
    state.stream = null;
  }

  function scheduleBootstrapRetry() {
    const plan = planBootstrapRetry({
      backoffMs: state.bootstrapRetryBackoffMs,
      baseMs: bootstrapRetry.baseMs,
      hasTimer: Boolean(state.bootstrapRetryTimer),
      isVisible: getVisible(),
      maxMs: bootstrapRetry.maxMs
    });
    if (!plan.schedule) {
      return;
    }

    state.bootstrapRetryBackoffMs = plan.nextBackoffMs;
    state.bootstrapRetryTimer = createTimeout(() => {
      state.bootstrapRetryTimer = null;
      if (getVisible()) {
        void lifecycle.bootstrap({ retrying: true });
        lifecycle.ensureStream();
      }
    }, plan.delay);
  }

  function ensureStream({ force = false } = {}) {
    if (state.stream && !force) {
      return;
    }

    if (force) {
      closeStream();
    }

    state.streamState = reconnectStreamState({ hasLiveState: getHasLiveState() });

    const nextStream = createEventSource(streamUrl);
    state.stream = nextStream;

    nextStream.addEventListener("snapshot", (event) => {
      if (state.stream !== nextStream) {
        return;
      }

      onSnapshot(JSON.parse(event.data));
      onRender();
    });

    nextStream.addEventListener("open", () => {
      if (state.stream !== nextStream) {
        return;
      }

      state.streamState = "live";
      resetStreamRecovery();
      onStreamOpen?.();
      if (state.refreshAfterStreamReconnect) {
        state.refreshAfterStreamReconnect = false;
        void lifecycle.refresh({ background: true });
      }
      onRender();
    });

    nextStream.addEventListener("live", (event) => {
      if (state.stream !== nextStream) {
        return;
      }

      onLive(JSON.parse(event.data));
      onRender();
    });

    nextStream.addEventListener("error", () => {
      if (state.stream !== nextStream) {
        return;
      }

      state.streamState = reconnectStreamState({ hasLiveState: getHasLiveState() });
      closeStream();
      onStreamError?.();
      scheduleStreamRecovery();
      onRender();
    });
  }

  function scheduleStreamRecovery() {
    const plan = planStreamRecovery({
      backoffMs: state.streamRecoveryBackoffMs,
      baseMs: streamRecovery.baseMs,
      hasLiveState: getHasLiveState(),
      hasTimer: Boolean(state.streamRecoveryTimer),
      isVisible: getVisible(),
      maxMs: streamRecovery.maxMs
    });
    if (!plan.schedule) {
      state.streamState = plan.streamState;
      return;
    }

    state.streamState = plan.streamState;
    state.streamRecoveryBackoffMs = plan.nextBackoffMs;
    state.streamRecoveryTimer = createTimeout(() => {
      state.streamRecoveryTimer = null;
      if (!getVisible()) {
        return;
      }

      state.refreshAfterStreamReconnect = plan.followupAction === "refresh";
      lifecycle.ensureStream({ force: true });
      if (plan.followupAction === "bootstrap") {
        void lifecycle.bootstrap({ retrying: true });
      }
    }, plan.delay);
  }

  async function bootstrap({ retrying = false } = {}) {
    if (state.bootstrapPromise) {
      return state.bootstrapPromise;
    }

    onBootstrapStart?.({ retrying });
    onRender();

    state.bootstrapPromise = requestBootstrap()
      .then(({ snapshot, live }) => {
        onBootstrapSuccess({ live, retrying, snapshot });
        state.streamState = "live";
        resetBootstrapRetry();
        onRender();
        return live;
      })
      .catch((error) => {
        state.streamState = reconnectStreamState({ hasLiveState: getHasLiveState() });
        onBootstrapError?.({ error, retrying });
        onRender();
        scheduleBootstrapRetry();
        return null;
      })
      .finally(() => {
        state.bootstrapPromise = null;
      });

    return state.bootstrapPromise;
  }

  async function refresh({ background = false } = {}) {
    if (state.refreshPromise) {
      return state.refreshPromise;
    }

    state.refreshPromise = Promise.resolve()
      .then(() => requestRefresh({ background }))
      .catch((error) => {
        if (background) {
          return null;
        }
        throw error;
      })
      .finally(() => {
        state.refreshPromise = null;
      });

    return state.refreshPromise;
  }

  function resumeVisible() {
    if (!getVisible()) {
      return;
    }

    lifecycle.ensureStream();
    if (!getHasLiveState()) {
      void lifecycle.bootstrap({ retrying: true });
    }
  }

  return lifecycle;
}
