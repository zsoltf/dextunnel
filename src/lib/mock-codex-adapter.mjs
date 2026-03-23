export function createMockCodexAdapter(store) {
  let heartbeat = null;

  function scheduleFollowUp(command) {
    if (command.type === "send_text") {
      setTimeout(() => {
        store.applyCommand({
          type: "simulate_assistant_turn",
          source: "mock-adapter",
          text: `Mock adapter reply: "${command.text.trim()}" was accepted. A real Codex adapter would now focus the app, submit the text, and stream the resulting turn back into the companion.`
        });
      }, 700);
      return;
    }

    if (command.type === "approve") {
      setTimeout(() => {
        store.applyCommand({
          type: "simulate_assistant_turn",
          source: "mock-adapter",
          text: "Approval path validated. The next native spike can wire this action to a real gated tool call or session step."
        });
      }, 500);
      return;
    }

    if (command.type === "set_strategy") {
      setTimeout(() => {
        store.applyCommand({
          type: "simulate_assistant_turn",
          source: "mock-adapter",
          text: "Capability ladder updated. This is where a real adapter would announce what semantic read and write paths are currently healthy."
        });
      }, 350);
    }
  }

  function start() {
    heartbeat = setInterval(() => {
      const snapshot = store.getState();
      const mode = snapshot.session.strategy.label;
      store.publishTranscript(
        "system",
        "status",
        `Heartbeat: host is still live in ${mode}. Transport is ${snapshot.session.transportLabel}.`
      );
    }, 45000);
  }

  function stop() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  return {
    start,
    stop,
    scheduleFollowUp
  };
}
