export function getSpeechRecognitionCtor(root = globalThis) {
  if (!root || typeof root !== "object") {
    return null;
  }

  return root.SpeechRecognition || root.webkitSpeechRecognition || null;
}

export function normalizeDictationText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function composeDictationDraft({
  baseText = "",
  committedText = "",
  interimText = ""
} = {}) {
  const parts = [
    normalizeDictationText(baseText),
    normalizeDictationText(committedText),
    normalizeDictationText(interimText)
  ].filter(Boolean);

  return parts.join(" ");
}

export function speechRecognitionErrorMessage(code = "") {
  switch (String(code || "").trim()) {
    case "aborted":
      return "Voice memo cancelled.";
    case "audio-capture":
      return "No microphone is available.";
    case "network":
      return "Voice memo failed because speech recognition lost network access.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it and try again.";
    case "no-speech":
      return "No speech detected. Try again.";
    default:
      return "Voice memo failed. Try again.";
  }
}
