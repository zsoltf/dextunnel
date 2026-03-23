function stripTrailingTelemetryLines(text = "") {
  const lines = String(text || "").split("\n");
  while (lines.length > 0) {
    const lastLine = String(lines.at(-1) || "").trim();
    if (!lastLine) {
      lines.pop();
      continue;
    }
    if (/^files=\d+\s*$/i.test(lastLine)) {
      lines.pop();
      continue;
    }
    if (/^\d+[mh]\d*[sm]?(?:\s+\d+[sm])?\s+·\s+/i.test(lastLine) || /^\d+(?:\.\d+)?s\s+·\s+/i.test(lastLine)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}

export function normalizeAgentRoomReply(participantId, rawText = "") {
  let text = String(rawText || "").replace(/\r\n/g, "\n").trim();
  if (!text) {
    return "";
  }

  const answerMatch = /(?:^|\n)Answer:\s*/g;
  let lastAnswerIndex = -1;
  for (const match of text.matchAll(answerMatch)) {
    lastAnswerIndex = match.index + match[0].length;
  }
  if (lastAnswerIndex >= 0) {
    text = text.slice(lastAnswerIndex).trim();
  }

  text = stripTrailingTelemetryLines(text);

  if (participantId === "oracle" && lastAnswerIndex < 0) {
    text = text
      .replace(/^.*?Launching .*?\n/si, "")
      .replace(/^[^\n]*oracle[^\n]*\n/i, "")
      .trim();
    text = stripTrailingTelemetryLines(text);
  }

  return text;
}
