export function applySharedSelectionState(
  state = {},
  {
    cwd = null,
    source = "remote",
    threadId = null,
    threads = []
  } = {}
) {
  const previousThreadId = state.selectedThreadId || null;
  const nextSelectedProjectCwd = cwd || state.selectedProjectCwd || "";

  let nextSelectedThreadId = previousThreadId;
  if (threadId) {
    nextSelectedThreadId = threadId;
  } else if (cwd) {
    const nextThread = (threads || []).find((candidate) => candidate.cwd === cwd) || null;
    nextSelectedThreadId = nextThread?.id || null;
  }

  const threadChanged = nextSelectedThreadId !== previousThreadId;

  return {
    nextState: {
      selectedProjectCwd: nextSelectedProjectCwd,
      selectedThreadId: nextSelectedThreadId,
      selectionSource: source,
      selectedThreadSnapshot: threadChanged ? null : state.selectedThreadSnapshot || null,
      turnDiff:
        state.turnDiff && state.turnDiff.threadId === nextSelectedThreadId
          ? state.turnDiff
          : null,
      writeLock:
        state.writeLock && state.writeLock.threadId === nextSelectedThreadId
          ? state.writeLock
          : null
    },
    threadChanged
  };
}
