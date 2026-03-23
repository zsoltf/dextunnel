import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ACCEPTED_LAUNCH_LIMITATIONS,
  LAUNCH_SUPPORT_DOCS,
  computeLaunchFingerprint,
  defaultLaunchStatusPath,
  deriveLaunchBar,
  readLaunchAttestation,
  writeLaunchAttestation
} from "../src/lib/launch-release-bar.mjs";

test("deriveLaunchBar requires current-fingerprint attestations", () => {
  const current = "head123:digest456";

  assert.deepEqual(deriveLaunchBar({ fingerprint: current, state: null }), {
    acceptedLimitations: ACCEPTED_LAUNCH_LIMITATIONS,
    automatedPass: false,
    docs: LAUNCH_SUPPORT_DOCS,
    manualPass: false,
    message: "Automated launch checks have not been confirmed for this build.",
    requiredManualChecks: [
      "Open the remote after a fresh restart and confirm the selected room loads cleanly.",
      "Switch feed filters and confirm the visible lane actually changes, not just the button state.",
      "Send or queue one remote reply and confirm the control and queue UX stays clear on the selected thread.",
      "Trigger Gemini or Oracle from the room and confirm the action only stages advisory text; it must not auto-send or silently take control.",
      "Use Reveal in Codex and confirm the correct desktop thread opens while the restart caveat stays visible.",
      "Confirm the remote clearly signals shared-room behavior and keeps drafts and queue local to that surface.",
      "If testing desktop visibility, restart the Codex app and confirm remote-written turns appear after restart."
    ],
    staleAutomated: false,
    staleManual: false,
    status: "RED"
  });

  assert.equal(
    deriveLaunchBar({
      fingerprint: current,
      state: {
        automated: { fingerprint: current }
      }
    }).status,
    "YELLOW"
  );

  assert.equal(
    deriveLaunchBar({
      fingerprint: current,
      state: {
        automated: { fingerprint: current },
        manual: { fingerprint: current }
      }
    }).status,
    "GREEN"
  );

  const stale = deriveLaunchBar({
    fingerprint: current,
    state: {
      automated: { fingerprint: "oldhead:olddigest" }
    }
  });
  assert.equal(stale.status, "RED");
  assert.equal(stale.staleAutomated, true);
  assert.deepEqual(stale.docs, LAUNCH_SUPPORT_DOCS);
  assert.deepEqual(stale.acceptedLimitations, ACCEPTED_LAUNCH_LIMITATIONS);
});

test("computeLaunchFingerprint uses git head plus status digest", () => {
  const calls = [];
  const fingerprint = computeLaunchFingerprint({
    cwd: "/tmp/dextunnel",
    execFileSyncImpl(command, args) {
      calls.push([command, args]);
      if (args[2] === "rev-parse" && args[3] === "--git-dir") {
        return ".git\n";
      }
      if (args[2] === "rev-parse" && args[3] === "HEAD") {
        return "abc123\n";
      }
      return " M public/remote.js\n?? test/new.test.mjs\n";
    }
  });

  assert.equal(fingerprint.head, "abc123");
  assert.equal(fingerprint.hasGit, true);
  assert.match(fingerprint.fingerprint, /^abc123:[a-f0-9]{40}$/);
  assert.equal(calls.length, 3);
});

test("computeLaunchFingerprint stays sensitive to working tree changes before first commit", () => {
  const fingerprint = computeLaunchFingerprint({
    cwd: "/tmp/dextunnel",
    execFileSyncImpl(_command, args) {
      if (args[2] === "rev-parse" && args[3] === "--git-dir") {
        return ".git\n";
      }
      if (args[2] === "rev-parse" && args[3] === "HEAD") {
        throw new Error("no HEAD yet");
      }
      return "?? public/remote.js\n?? src/server.mjs\n";
    }
  });

  assert.equal(fingerprint.hasGit, true);
  assert.equal(fingerprint.head, null);
  assert.match(fingerprint.fingerprint, /^nohead:[a-f0-9]{40}$/);
});

test("launch attestations persist and can be read back", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "dextunnel-launch-bar-"));
  const statusPath = defaultLaunchStatusPath({ cwd });
  const fingerprint = {
    fingerprint: "head999:digest999",
    hasGit: true,
    head: "head999"
  };

  await writeLaunchAttestation({
    cwd,
    kind: "automated",
    now: "2026-03-19T20:00:00.000Z",
    statusPath,
    fingerprint
  });
  await writeLaunchAttestation({
    cwd,
    kind: "manual",
    now: "2026-03-19T20:05:00.000Z",
    statusPath,
    fingerprint
  });

  const persisted = await readLaunchAttestation({ statusPath });
  assert.equal(persisted.automated.recordedAt, "2026-03-19T20:00:00.000Z");
  assert.equal(persisted.manual.recordedAt, "2026-03-19T20:05:00.000Z");

  const raw = JSON.parse(await readFile(statusPath, "utf8"));
  assert.equal(raw.automated.fingerprint, "head999:digest999");
  assert.equal(raw.manual.fingerprint, "head999:digest999");
});
