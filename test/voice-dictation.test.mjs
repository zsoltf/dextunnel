import test from "node:test";
import assert from "node:assert/strict";

import {
  composeDictationDraft,
  getSpeechRecognitionCtor,
  speechRecognitionErrorMessage
} from "../public/voice-dictation.js";

test("composeDictationDraft joins base, committed, and interim text cleanly", () => {
  assert.equal(
    composeDictationDraft({
      baseText: "Ship this",
      committedText: "voice memo",
      interimText: "today"
    }),
    "Ship this voice memo today"
  );
});

test("composeDictationDraft trims noisy whitespace", () => {
  assert.equal(
    composeDictationDraft({
      baseText: "  hello   world ",
      committedText: " from  mobile ",
      interimText: " dictation "
    }),
    "hello world from mobile dictation"
  );
});

test("getSpeechRecognitionCtor prefers standard SpeechRecognition", () => {
  function Standard() {}
  function Webkit() {}

  assert.equal(
    getSpeechRecognitionCtor({
      SpeechRecognition: Standard,
      webkitSpeechRecognition: Webkit
    }),
    Standard
  );
});

test("getSpeechRecognitionCtor falls back to webkitSpeechRecognition", () => {
  function Webkit() {}

  assert.equal(
    getSpeechRecognitionCtor({
      webkitSpeechRecognition: Webkit
    }),
    Webkit
  );
});

test("speechRecognitionErrorMessage maps microphone and no-speech failures", () => {
  assert.equal(
    speechRecognitionErrorMessage("not-allowed"),
    "Microphone access is blocked. Allow it and try again."
  );
  assert.equal(
    speechRecognitionErrorMessage("no-speech"),
    "No speech detected. Try again."
  );
});
