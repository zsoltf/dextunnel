import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { AGENT_ROOM_MEMBER_IDS } from "./agent-room-state.mjs";
import { normalizeAgentRoomReply } from "./agent-room-text.mjs";

function scriptPath(...parts) {
  return path.join(process.env.HOME || "", ".agents", "skills", ...parts);
}

function buildLanePrompt(participantId, promptText = "") {
  return [
    `You are ${participantId} in the Dextunnel council room.`,
    "This is an advisory-only group discussion, not the main Codex control lane.",
    "Reply as that named participant, directly to the room.",
    "Be concise but useful. It is okay to disagree with the other participants.",
    "Do not claim you executed tools or changed files unless the provided context explicitly says so.",
    "",
    "Latest room prompt:",
    promptText
  ].join("\n");
}

function resolveOracleLaneConfig() {
  const remoteChrome = String(
    process.env.DEXTUNNEL_ORACLE_REMOTE_CHROME || process.env.ORACLE_REMOTE_CHROME || ""
  ).trim();
  const projectUrl = String(
    process.env.DEXTUNNEL_ORACLE_PROJECT_URL || process.env.ORACLE_PROJECT_URL || ""
  ).trim();

  if (!remoteChrome || !projectUrl) {
    throw new Error(
      "Oracle lane requires DEXTUNNEL_ORACLE_REMOTE_CHROME/ORACLE_REMOTE_CHROME and DEXTUNNEL_ORACLE_PROJECT_URL/ORACLE_PROJECT_URL."
    );
  }

  return { projectUrl, remoteChrome };
}

function spawnAndCollect(command, args, { cwd = process.cwd(), env = process.env, stdin = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with ${code}`));
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

async function runLoggedWrapper(script, args, options = {}) {
  if (!script) {
    throw new Error("Missing lane wrapper.");
  }
  return spawnAndCollect(script, args, options);
}

async function runNixLane({
  codexBinaryPath,
  contextFile,
  cwd = process.cwd(),
  promptText,
  roundDir
} = {}) {
  await mkdir(roundDir, { recursive: true });
  const requestFile = path.join(roundDir, "nix.request.txt");
  const request = [
    "You are Nix, a thoughtful Dextunnel council-room participant.",
    "This is advisory discussion only.",
    "Reply in first person as Nix, directly to the room, with a concise but concrete response.",
    "",
    "# Prompt",
    buildLanePrompt("nix", promptText),
    "",
    "# Context",
    await readFile(contextFile, "utf8")
  ].join("\n");

  await writeFile(requestFile, request, "utf8");

  const { stdout } = await spawnAndCollect(
    codexBinaryPath || "codex",
    [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "-C",
      cwd,
      "-"
    ],
    {
      cwd,
      stdin: request
    }
  );

  return stdout.trim();
}

export function createAgentRoomRuntime({
  artifactsDir,
  codexBinaryPath,
  cwd = process.cwd(),
  fake = false,
  fakeFailures = {},
  now = () => new Date().toISOString(),
  participantRunner = null,
  participantTimeoutMs = 5 * 60 * 1000
} = {}) {
  if (!artifactsDir) {
    throw new Error("createAgentRoomRuntime requires artifactsDir.");
  }

  const pendingFakeFailures = new Map(
    Object.entries(fakeFailures || {})
      .map(([participantId, spec]) => {
        const nextParticipantId = String(participantId || "").trim().toLowerCase();
        const mode = String(spec?.mode || "").trim().toLowerCase();
        const count = Math.max(1, Number(spec?.count || 1) || 1);
        if (!nextParticipantId || !["timeout", "malformed", "error"].includes(mode)) {
          return null;
        }
        return [nextParticipantId, { count, mode }];
      })
      .filter(Boolean)
  );

  async function createRoundDir(threadId, roundId) {
    const root = path.join(artifactsDir, sanitize(threadId), sanitize(roundId));
    await mkdir(root, { recursive: true });
    return mkdtemp(path.join(root, "run-"));
  }

  async function executeParticipant({
    contextFile,
    participantId,
    promptText,
    roundDir
  } = {}) {
    if (participantRunner) {
      return participantRunner({
        contextFile,
        participantId,
        promptText,
        roundDir
      });
    }

    if (fake) {
      const failureSpec = pendingFakeFailures.get(participantId);
      if (failureSpec) {
        if (failureSpec.count > 1) {
          pendingFakeFailures.set(participantId, {
            ...failureSpec,
            count: failureSpec.count - 1
          });
        } else {
          pendingFakeFailures.delete(participantId);
        }

        if (failureSpec.mode === "timeout") {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error(`${participantId} timed out after ${participantTimeoutMs}ms.`);
        } else if (failureSpec.mode === "malformed") {
          return "   ";
        } else {
          throw new Error(`${participantId} fake lane failure.`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, participantId === "oracle" ? 80 : 20));
      return `${participantId}: ${promptText}`.trim();
    }

    switch (participantId) {
      case "spark": {
        const { stdout } = await runLoggedWrapper(
          scriptPath("spark", "scripts", "spark_logged.sh"),
          [
            "--slug",
            `agent-room-${participantId}`,
            "--context-file",
            contextFile,
            "--prompt",
            buildLanePrompt(participantId, promptText)
          ],
          { cwd }
        );
        return normalizeAgentRoomReply(participantId, stdout);
      }
      case "gemini": {
        const { stdout } = await runLoggedWrapper(
          scriptPath("gemini", "scripts", "gemini_logged.sh"),
          [
            "--slug",
            `agent-room-${participantId}`,
            "--context-file",
            contextFile,
            "--prompt",
            buildLanePrompt(participantId, promptText)
          ],
          { cwd }
        );
        return normalizeAgentRoomReply(participantId, stdout);
      }
      case "claude": {
        const { stdout } = await runLoggedWrapper(
          scriptPath("claude", "scripts", "claude_logged.sh"),
          [
            "--slug",
            `agent-room-${participantId}`,
            "--context-file",
            contextFile,
            "--prompt",
            buildLanePrompt(participantId, promptText)
          ],
          { cwd }
        );
        return normalizeAgentRoomReply(participantId, stdout);
      }
      case "oracle": {
        const { projectUrl, remoteChrome } = resolveOracleLaneConfig();
        const { stdout } = await runLoggedWrapper(
          scriptPath("oracle", "scripts", "oracle_logged.sh"),
          [
            "--engine",
            "browser",
            "--remote-chrome",
            remoteChrome,
            "--chatgpt-url",
            projectUrl,
            "--browser-model-strategy",
            "current",
            "--file",
            contextFile,
            "-p",
            buildLanePrompt(participantId, promptText)
          ],
          { cwd }
        );
        return normalizeAgentRoomReply(participantId, stdout);
      }
      case "nix":
        return normalizeAgentRoomReply(
          participantId,
          await runNixLane({
          codexBinaryPath,
          contextFile,
          cwd,
          promptText,
          roundDir
          })
        );
      default:
        throw new Error(`Unsupported council participant: ${participantId}`);
    }
  }

  async function runParticipant(args = {}) {
    const { participantId } = args;
    const timeoutLabel = `${participantId} timed out after ${participantTimeoutMs}ms.`;
    let timer = null;
    try {
      const raw = await Promise.race([
        executeParticipant(args),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(timeoutLabel));
          }, participantTimeoutMs);
          timer.unref?.();
        })
      ]);

      const normalized = normalizeAgentRoomReply(participantId, raw || "");
      if (!normalized.trim()) {
        throw new Error(`${participantId} returned a malformed reply.`);
      }

      return normalized;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function runRound({
    contextMarkdown,
    participantIds = AGENT_ROOM_MEMBER_IDS,
    promptText,
    roundId,
    threadId
  } = {}) {
    const roundDir = await createRoundDir(threadId, roundId);
    const contextFile = path.join(roundDir, "context.md");
    await writeFile(contextFile, contextMarkdown, "utf8");

    return Promise.allSettled(
      participantIds.map(async (participantId) => ({
        participantId,
        text: await runParticipant({
          contextFile,
          participantId,
          promptText,
          roundDir
        })
      }))
    );
  }

  return {
    async prepareRound({ contextMarkdown, roundId, threadId } = {}) {
      const roundDir = await createRoundDir(threadId, roundId);
      const contextFile = path.join(roundDir, "context.md");
      await writeFile(contextFile, contextMarkdown, "utf8");
    return {
      contextFile,
      roundDir
    };
    },
    runParticipant,
    runRound
  };
}

function sanitize(value = "") {
  return String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-") || "item";
}
