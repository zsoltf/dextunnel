import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { APP_SERVER_DRIFT_RUNBOOK_PATH } from "./app-server-contract.mjs";

export function defaultLaunchStatusPath({ cwd = process.cwd() } = {}) {
  return path.join(cwd, ".agent", "artifacts", "launch", "local-launch-status.json");
}

export function computeLaunchFingerprint({
  cwd = process.cwd(),
  execFileSyncImpl = execFileSync
} = {}) {
  try {
    execFileSyncImpl("git", ["-C", cwd, "rev-parse", "--git-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();

    let head = null;
    try {
      head = execFileSyncImpl("git", ["-C", cwd, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
      head = null;
    }

    const status = execFileSyncImpl(
      "git",
      ["-C", cwd, "status", "--porcelain=v1", "--untracked-files=normal"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }
    ).trimEnd();
    const digest = createHash("sha1").update(status).digest("hex");
    return {
      head,
      hasGit: true,
      statusDigest: digest,
      fingerprint: `${head || "nohead"}:${digest}`
    };
  } catch {
    const digest = createHash("sha1").update(cwd).digest("hex");
    return {
      head: null,
      hasGit: false,
      statusDigest: digest,
      fingerprint: `nogit:${digest}`
    };
  }
}

export async function readLaunchAttestation({ statusPath = defaultLaunchStatusPath() } = {}) {
  try {
    const raw = await readFile(statusPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function deriveLaunchBar({
  fingerprint,
  state,
  requiredManualChecks = DEFAULT_MANUAL_CHECKS
}) {
  const automatedPass = Boolean(state?.automated?.fingerprint === fingerprint);
  const manualPass = Boolean(state?.manual?.fingerprint === fingerprint);

  const staleAutomated = Boolean(state?.automated && !automatedPass);
  const staleManual = Boolean(state?.manual && !manualPass);

  let status = "RED";
  let message = "Automated launch checks have not been confirmed for this build.";
  if (automatedPass && manualPass) {
    status = "GREEN";
    message = "Local launch bar is green.";
  } else if (automatedPass) {
    status = "YELLOW";
    message = "Automated launch bar is green. Manual launch checks still required.";
  } else if (staleAutomated || staleManual) {
    message = "Launch attestations are stale for the current repo state. Re-run the launch checks.";
  }

  return {
    acceptedLimitations: ACCEPTED_LAUNCH_LIMITATIONS,
    automatedPass,
    docs: LAUNCH_SUPPORT_DOCS,
    manualPass,
    message,
    requiredManualChecks,
    staleAutomated,
    staleManual,
    status
  };
}

export async function writeLaunchAttestation({
  kind,
  cwd = process.cwd(),
  statusPath = defaultLaunchStatusPath({ cwd }),
  now = new Date().toISOString(),
  fingerprint = computeLaunchFingerprint({ cwd })
} = {}) {
  if (!kind || !["automated", "manual"].includes(kind)) {
    throw new Error("writeLaunchAttestation requires kind=automated|manual");
  }

  const current = (await readLaunchAttestation({ statusPath })) ?? { version: 1 };
  const next = {
    ...current,
    version: 1,
    [kind]: {
      fingerprint: fingerprint.fingerprint,
      hasGit: fingerprint.hasGit,
      head: fingerprint.head,
      recordedAt: now
    }
  };

  await mkdir(path.dirname(statusPath), { recursive: true });
  await writeFile(statusPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function clearLaunchAttestations({
  statusPath = defaultLaunchStatusPath()
} = {}) {
  await rm(statusPath, { force: true });
}

export const DEFAULT_MANUAL_CHECKS = [
  "Open the remote after a fresh restart and confirm the selected room loads cleanly.",
  "Switch feed filters and confirm the visible lane actually changes, not just the button state.",
  "Send or queue one remote reply and confirm the control and queue UX stays clear on the selected thread.",
  "Trigger Gemini or Oracle from the room and confirm the action only stages advisory text; it must not auto-send or silently take control.",
  "Use Reveal in Codex and confirm the correct desktop thread opens while the restart caveat stays visible.",
  "Confirm the remote clearly signals shared-room behavior and keeps drafts and queue local to that surface.",
  "If testing desktop visibility, restart the Codex app and confirm remote-written turns appear after restart."
];

export const ACCEPTED_LAUNCH_LIMITATIONS = [
  "Desktop Codex still requires a full app restart to reliably rehydrate externally written turns.",
  "Reveal in Codex is a navigation aid, not a desktop visibility promise.",
  "Desktop recovery is manual: quit and reopen the Codex app when you need to see newer turns there."
];

export const LAUNCH_SUPPORT_DOCS = [
  "docs/ops/apple-host-options.md",
  "docs/ops/apple-menubar-release.md",
  "docs/ops/bridge-api-contract.md",
  "docs/ops/desktop-sync.md"
];
