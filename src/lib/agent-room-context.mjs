function formatTimestampLabel(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function formatContextEntries(entries = [], limit = 10, { trimTopicText }) {
  return entries
    .slice(-limit)
    .map((entry) => {
      const label = entry?.participant?.label || entry?.participantId || entry?.origin || entry?.lane || entry?.role || "voice";
      const text = trimTopicText(entry?.text || "", 280);
      const timestamp = entry?.timestamp ? formatTimestampLabel(entry.timestamp) : "";
      return `- ${timestamp ? `[${timestamp}] ` : ""}${label}: ${text}`;
    })
    .join("\n");
}

export function createAgentRoomContextBuilder({
  buildSelectedChannel,
  decorateSnapshot,
  nowIso,
  trimTopicText
}) {
  function buildAgentRoomContextMarkdown({ roomState, snapshot, threadId }) {
    const selectedSnapshot = snapshot ? decorateSnapshot(snapshot) : null;
    const channel = selectedSnapshot?.channel || buildSelectedChannel(selectedSnapshot);
    const mainEntries = selectedSnapshot?.transcript || [];
    const roomEntries = roomState?.messages || [];

    return [
      "# Dextunnel Council Room Context",
      "",
      `generated_at: ${nowIso()}`,
      `thread_id: ${threadId || channel.channelId || ""}`,
      `server: ${channel.serverLabel || ""}`,
      `channel: ${channel.channelSlug || ""}`,
      `topic: ${channel.topic || ""}`,
      "",
      "## Main Codex thread excerpt",
      formatContextEntries(mainEntries, 10, { trimTopicText }) || "- No main-thread transcript available.",
      "",
      "## Council room transcript",
      formatContextEntries(roomEntries, 20, { trimTopicText }) || "- No prior council-room messages.",
      ""
    ].join("\n");
  }

  return {
    buildAgentRoomContextMarkdown
  };
}
