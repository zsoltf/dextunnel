import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CODEX_NAVIGATION_SEQUENCES = {
  viewBackForward: [
    { itemTitle: "Back", menuTitle: "View" },
    { itemTitle: "Forward", menuTitle: "View" }
  ],
  viewPreviousNextThread: [
    { itemTitle: "Previous Thread", menuTitle: "View" },
    { itemTitle: "Next Thread", menuTitle: "View" }
  ]
};

function escapeAppleScriptString(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

export function buildCodexMenuItemAppleScript({
  activate = true,
  activationDelaySeconds = 0.2,
  itemTitle,
  menuTitle
} = {}) {
  const escapedMenuTitle = escapeAppleScriptString(menuTitle);
  const escapedItemTitle = escapeAppleScriptString(itemTitle);
  const lines = [];

  if (activate) {
    lines.push('tell application "Codex" to activate');
    if (activationDelaySeconds > 0) {
      lines.push(`delay ${Number(activationDelaySeconds)}`);
    }
  }

  lines.push('tell application "System Events"');
  lines.push('  tell process "Codex"');
  lines.push(
    `    click menu item "${escapedItemTitle}" of menu "${escapedMenuTitle}" of menu bar item "${escapedMenuTitle}" of menu bar 1`
  );
  lines.push("  end tell");
  lines.push("end tell");

  return lines;
}

export async function activateCodex({
  activationDelayMs = 200,
  openCommand = execFileAsync,
  wait = delay
} = {}) {
  await openCommand("osascript", ["-e", 'tell application "Codex" to activate']);
  if (activationDelayMs > 0) {
    await wait(activationDelayMs);
  }
  return {
    activated: true
  };
}

export async function runCodexMenuItem(
  {
    activate = true,
    activationDelaySeconds = 0.2,
    itemTitle,
    menuTitle
  } = {},
  { scriptCommand = execFileAsync } = {}
) {
  if (!menuTitle || !itemTitle) {
    throw new Error("menuTitle and itemTitle are required");
  }

  const scriptLines = buildCodexMenuItemAppleScript({
    activate,
    activationDelaySeconds,
    itemTitle,
    menuTitle
  });
  const args = scriptLines.flatMap((line) => ["-e", line]);
  await scriptCommand("osascript", args);
  return {
    activated: activate,
    itemTitle,
    menuTitle
  };
}

export async function runCodexNavigationSequence(
  sequenceId,
  {
    activateEachStep = false,
    activationDelaySeconds = 0.2,
    runMenuItem = runCodexMenuItem,
    stepDelayMs = 120,
    wait = delay
  } = {}
) {
  const steps = CODEX_NAVIGATION_SEQUENCES[sequenceId];
  if (!Array.isArray(steps)) {
    throw new Error(`Unknown Codex navigation sequence: ${sequenceId}`);
  }

  const completed = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const result = await runMenuItem(
      {
        activate: activateEachStep || index === 0,
        activationDelaySeconds,
        ...step
      }
    );
    completed.push(result);
    if (index < steps.length - 1 && stepDelayMs > 0) {
      await wait(stepDelayMs);
    }
  }

  return {
    sequenceId,
    steps: completed
  };
}

export function buildCodexThreadDeeplink(threadId) {
  const normalized = String(threadId || "").trim();
  if (!normalized) {
    throw new Error("threadId is required");
  }

  return `codex://threads/${encodeURIComponent(normalized)}`;
}

export async function openThreadInCodex(threadId, { openCommand = execFileAsync } = {}) {
  const deeplink = buildCodexThreadDeeplink(threadId);
  await openCommand("open", [deeplink]);
  return {
    deeplink,
    threadId: String(threadId || "").trim()
  };
}
