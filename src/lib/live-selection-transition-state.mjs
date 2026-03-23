import { clearControlLease } from "./shared-room-state.mjs";
import { applySharedSelectionState } from "./shared-selection-state.mjs";

export function applyLiveSelectionTransition(
  state = {},
  {
    cwd = null,
    source = "remote",
    threadId = null,
    threads = []
  } = {},
  { now = Date.now() } = {}
) {
  const previousThreadId = state.selectedThreadId || null;
  const selection = applySharedSelectionState(
    {
      selectedProjectCwd: state.selectedProjectCwd || "",
      selectedThreadId: previousThreadId,
      selectedThreadSnapshot: state.selectedThreadSnapshot || null,
      selectionSource: state.selectionSource || "remote",
      turnDiff: state.turnDiff || null,
      writeLock: state.writeLock || null
    },
    {
      cwd,
      source,
      threadId,
      threads
    }
  );

  const interactionFlow = selection.threadChanged ? null : state.interactionFlow || null;
  const controlLease = selection.threadChanged
    ? clearControlLease(state.controlLease || null, { now, threadId: previousThreadId || null })
    : state.controlLease || null;

  return {
    cleared: {
      controlLease: selection.threadChanged && Boolean(state.controlLease),
      interactionFlow: selection.threadChanged && Boolean(state.interactionFlow)
    },
    nextState: {
      ...selection.nextState,
      controlLease,
      interactionFlow
    },
    threadChanged: selection.threadChanged
  };
}
