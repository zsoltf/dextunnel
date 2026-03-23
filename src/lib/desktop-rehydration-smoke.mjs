import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { createCodexAppServerBridge } from "./codex-app-server-client.mjs";
import {
  openThreadInCodex,
  runCodexNavigationSequence
} from "./desktop-integration.mjs";

export const DESKTOP_REHYDRATION_ATTEMPTS = [
  {
    category: "desktop",
    destructive: false,
    expectedDesktopOutcome: "navigation-only",
    id: "revealInCodex",
    label: "Reveal in Codex"
  },
  {
    category: "appServer",
    destructive: false,
    expectedDesktopOutcome: "none",
    id: "threadRead",
    label: "app-server thread/read"
  },
  {
    category: "appServer",
    destructive: false,
    expectedDesktopOutcome: "negative",
    id: "threadResume",
    label: "app-server thread/resume"
  },
  {
    category: "desktop",
    destructive: false,
    expectedDesktopOutcome: "negative",
    id: "viewBackForward",
    label: "Codex View -> Back / Forward"
  },
  {
    category: "desktop",
    destructive: false,
    expectedDesktopOutcome: "negative",
    id: "viewPreviousNextThread",
    label: "Codex View -> Previous Thread / Next Thread"
  }
];

function defaultStamp(now = new Date()) {
  const iso = now.toISOString().replace(/[-:.]/g, "");
  return iso.replace(".000Z", "Z");
}

function buildProbe(promptStamp) {
  const normalized = String(promptStamp || defaultStamp()).trim();
  const prompt = `REHYDRATION_SMOKE_${normalized}. Reply with exactly: REHYDRATION_SMOKE_ACK_${normalized}.`;
  const ack = `REHYDRATION_SMOKE_ACK_${normalized}`;
  return {
    ack,
    prompt,
    stamp: normalized
  };
}

function objectContainsMarker(value, marker) {
  return JSON.stringify(value || {}).includes(marker);
}

function stringifyError(error) {
  if (!error) {
    return "Unknown error.";
  }
  if (error instanceof Error) {
    return error.message || error.name || "Error";
  }
  return String(error);
}

function createManualChecks({ probe } = {}) {
  return [
    `After each attempt, check whether "${probe.prompt}" and "${probe.ack}" are visible in Codex without restarting.`,
    "Expect Reveal in Codex to navigate only, not force desktop rehydration.",
    "Expect thread/read and thread/resume to prove app-server state, not the desktop view.",
    "Expect View navigation attempts to stay best-effort and currently negative unless Codex changed.",
    `If you need a positive desktop visibility check, quit and reopen the Codex app manually and confirm "${probe.prompt}" and "${probe.ack}" appear afterward.`
  ];
}

async function waitForProbeReadback(
  bridge,
  threadId,
  {
    ack,
    prompt,
    probePollMs = 1200,
    probeTimeoutMs = 45000,
    seed = {},
    wait = delay
  } = {}
) {
  let promptVisible = Boolean(seed.promptVisible);
  let ackVisible = Boolean(seed.ackVisible);
  let thread = seed.thread || null;
  const startedAt = Date.now();

  while (!(promptVisible && ackVisible)) {
    thread = await bridge.readThread(threadId, true);
    promptVisible = objectContainsMarker(thread, prompt);
    ackVisible = objectContainsMarker(thread, ack);

    if (promptVisible && ackVisible) {
      break;
    }

    if (Date.now() - startedAt >= probeTimeoutMs) {
      break;
    }

    if (probePollMs > 0) {
      await wait(probePollMs);
    }
  }

  return {
    ackVisible,
    promptVisible,
    status: promptVisible && ackVisible ? "persisted" : "readback-mismatch",
    thread
  };
}

export async function runDesktopRehydrationSmoke({
  bridgeFactory = createCodexAppServerBridge,
  cwd = process.cwd(),
  includeProbe = true,
  openThread = openThreadInCodex,
  probePollMs = 1200,
  promptStamp = defaultStamp(),
  probeTimeoutMs = 45000,
  runNavigationSequence = runCodexNavigationSequence,
  threadId,
  wait = delay
} = {}) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) {
    throw new Error("threadId is required");
  }

  const bridge = await bridgeFactory();
  const probe = buildProbe(promptStamp);
  const report = {
    attempts: [],
    cwd,
    manualChecks: [],
    probe: {
      ...probe,
      included: includeProbe,
      status: includeProbe ? "pending" : "skipped"
    },
    threadId: normalizedThreadId
  };

  const pushAttempt = (entry) => {
    report.attempts.push(entry);
    return entry;
  };

  try {
    if (includeProbe) {
      const sendResult = await bridge.sendText({
        createThreadIfMissing: false,
        cwd,
        text: probe.prompt,
        threadId: normalizedThreadId,
        timeoutMs: probeTimeoutMs
      });
      const readback = await waitForProbeReadback(bridge, normalizedThreadId, {
        ack: probe.ack,
        prompt: probe.prompt,
        probePollMs,
        probeTimeoutMs,
        seed: {
          ackVisible: objectContainsMarker(sendResult?.snapshot, probe.ack),
          promptVisible: objectContainsMarker(sendResult?.snapshot, probe.prompt),
          thread: sendResult?.thread || null
        },
        wait
      });
      report.probe = {
        ...probe,
        ackVisible: readback.ackVisible,
        included: true,
        promptVisible: readback.promptVisible,
        status: readback.status,
        turnId: sendResult?.turn?.id || null,
        turnStatus: sendResult?.turn?.status || null
      };
    }

    const skipDesktopAttempts = includeProbe && report.probe.status !== "persisted";

    for (const attempt of DESKTOP_REHYDRATION_ATTEMPTS) {
      if (skipDesktopAttempts && attempt.category === "desktop") {
        pushAttempt({
          ...attempt,
          detail: "Skipped because write/readback proof did not settle cleanly.",
          status: "skipped"
        });
        continue;
      }

      try {
        let result = null;

        switch (attempt.id) {
          case "revealInCodex":
            result = await openThread(normalizedThreadId);
            break;
          case "threadRead": {
            const thread = await bridge.readThread(normalizedThreadId, true);
            result = {
              ackVisible: includeProbe ? objectContainsMarker(thread, probe.ack) : null,
              promptVisible: includeProbe ? objectContainsMarker(thread, probe.prompt) : null,
              threadId: thread?.id || normalizedThreadId
            };
            break;
          }
          case "threadResume": {
            const thread = await bridge.resumeThread({
              cwd,
              threadId: normalizedThreadId
            });
            result = {
              ackVisible: includeProbe ? objectContainsMarker(thread, probe.ack) : null,
              promptVisible: includeProbe ? objectContainsMarker(thread, probe.prompt) : null,
              threadId: thread?.id || normalizedThreadId
            };
            break;
          }
          case "viewBackForward":
            result = await runNavigationSequence("viewBackForward");
            break;
          case "viewPreviousNextThread":
            result = await runNavigationSequence("viewPreviousNextThread");
            break;
          default:
            throw new Error(`Unknown rehydration attempt: ${attempt.id}`);
        }

        pushAttempt({
          ...attempt,
          result,
          status: "ok"
        });
      } catch (error) {
        pushAttempt({
          ...attempt,
          detail: stringifyError(error),
          status: "failed"
        });
      }
    }

    report.manualChecks = createManualChecks({ probe });

    return report;
  } finally {
    await bridge.dispose?.();
  }
}
