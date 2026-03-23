import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createCodexRuntime } from "../src/lib/app-server-runtime.mjs";
import {
  buildCodexMenuItemAppleScript,
  buildCodexThreadDeeplink,
  CODEX_NAVIGATION_SEQUENCES,
  runCodexMenuItem,
  runCodexNavigationSequence,
  openThreadInCodex
} from "../src/lib/desktop-integration.mjs";
import { createRepoChangesService } from "../src/lib/repo-changes-service.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  await execFileAsync("git", args, { cwd });
}

test("desktop integration builds a deeplink and delegates to the open command", async () => {
  const calls = [];

  const result = await openThreadInCodex("thread-123", {
    openCommand: async (command, args) => {
      calls.push({ args, command });
      return { stdout: "" };
    }
  });

  assert.equal(buildCodexThreadDeeplink("thread-123"), "codex://threads/thread-123");
  assert.deepEqual(calls, [
    {
      args: ["codex://threads/thread-123"],
      command: "open"
    }
  ]);
  assert.deepEqual(result, {
    deeplink: "codex://threads/thread-123",
    threadId: "thread-123"
  });
});

test("desktop integration builds a menu-item AppleScript with safe quoting", () => {
  const lines = buildCodexMenuItemAppleScript({
    itemTitle: 'Next "Thread"',
    menuTitle: "View"
  });

  assert.deepEqual(lines, [
    'tell application "Codex" to activate',
    "delay 0.2",
    'tell application "System Events"',
    '  tell process "Codex"',
    '    click menu item "Next \\"Thread\\"" of menu "View" of menu bar item "View" of menu bar 1',
    "  end tell",
    "end tell"
  ]);
});

test("desktop integration runs a single Codex menu item through osascript", async () => {
  const calls = [];

  const result = await runCodexMenuItem(
    {
      itemTitle: "Back",
      menuTitle: "View"
    },
    {
      scriptCommand: async (command, args) => {
        calls.push({ args, command });
        return { stdout: "" };
      }
    }
  );

  assert.equal(result.menuTitle, "View");
  assert.equal(result.itemTitle, "Back");
  assert.deepEqual(calls, [
    {
      args: [
        "-e",
        'tell application "Codex" to activate',
        "-e",
        "delay 0.2",
        "-e",
        'tell application "System Events"',
        "-e",
        '  tell process "Codex"',
        "-e",
        '    click menu item "Back" of menu "View" of menu bar item "View" of menu bar 1',
        "-e",
        "  end tell",
        "-e",
        "end tell"
      ],
      command: "osascript"
    }
  ]);
});

test("desktop integration runs a named navigation sequence in order", async () => {
  const calls = [];

  const result = await runCodexNavigationSequence("viewBackForward", {
    runMenuItem: async (step) => {
      calls.push(step);
      return step;
    },
    stepDelayMs: 0,
    wait: async () => {}
  });

  assert.deepEqual(result, {
    sequenceId: "viewBackForward",
    steps: CODEX_NAVIGATION_SEQUENCES.viewBackForward.map((step, index) => ({
      activate: index === 0,
      activationDelaySeconds: 0.2,
      ...step
    }))
  });
  assert.deepEqual(calls, CODEX_NAVIGATION_SEQUENCES.viewBackForward.map((step, index) => ({
    activate: index === 0,
    activationDelaySeconds: 0.2,
    ...step
  })));
});

test("app-server runtime creates fake bridge state with a stable selected cwd", async () => {
  const runtime = createCodexRuntime({
    binaryPath: "/tmp/fake-codex",
    cwd: "/tmp/dextunnel-runtime",
    fakeSendDelayMs: 25,
    listenUrl: "ws://127.0.0.1:9999",
    useFakeAppServer: true
  });

  assert.equal(runtime.liveState.selectedProjectCwd, "/tmp/dextunnel-runtime");
  assert.equal(runtime.liveState.selectionSource, "remote");
  assert.equal(runtime.appServerState.lastWrite, null);

  const threads = await runtime.codexAppServer.listThreads({
    cwd: "/tmp/dextunnel-runtime",
    limit: 5
  });
  assert.ok(Array.isArray(threads));
  assert.ok(threads.length >= 1);
});

test("repo changes service caches results until invalidated", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "dextunnel-runtime-"));
  const threadPath = path.join(cwd, ".codex", "session.jsonl");
  const srcDir = path.join(cwd, "src");
  const codexDir = path.join(cwd, ".codex");

  await execFileAsync("mkdir", ["-p", srcDir, codexDir]);
  await git(cwd, ["init"]);
  await git(cwd, ["config", "user.email", "test@example.com"]);
  await git(cwd, ["config", "user.name", "Dextunnel Test"]);

  await writeFile(path.join(cwd, "README.md"), "# test\n", "utf8");
  await writeFile(path.join(srcDir, "app.mjs"), "export const app = 1;\n", "utf8");
  await writeFile(threadPath, `${cwd}/src/app.mjs\n`, "utf8");
  await git(cwd, ["add", "README.md", "src/app.mjs"]);
  await git(cwd, ["commit", "-m", "init"]);

  await writeFile(path.join(srcDir, "app.mjs"), "export const app = 2;\n", "utf8");

  const service = createRepoChangesService({
    cacheTtlMs: 60_000,
    gitCommandTimeoutMs: 4_000,
    sessionLogTailBytes: 64 * 1024
  });

  const first = await service.getCachedRepoChanges(cwd, { threadPath });
  assert.equal(first.supported, true);
  assert.ok(first.items.some((item) => item.path === "src/app.mjs"));

  await writeFile(path.join(cwd, "README.md"), "# changed after cache\n", "utf8");
  const second = await service.getCachedRepoChanges(cwd, { threadPath });
  assert.deepEqual(second, first);

  service.invalidateRepoChangesCache({ cwd, threadPath });
  const third = await service.getCachedRepoChanges(cwd, { threadPath });
  assert.ok(third.items.some((item) => item.path === "README.md"));
});
