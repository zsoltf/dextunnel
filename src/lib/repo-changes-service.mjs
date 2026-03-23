import { execFile } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function classifyChange(statusCode) {
  if (statusCode === "??") {
    return "untracked";
  }

  if (statusCode.includes("R")) {
    return "renamed";
  }

  if (statusCode.includes("A")) {
    return "added";
  }

  if (statusCode.includes("D")) {
    return "deleted";
  }

  if (statusCode.includes("U")) {
    return "unmerged";
  }

  return "modified";
}

function parseStatusLine(line) {
  const statusCode = line.slice(0, 2);
  const rawPath = line.slice(3);
  const [fromPath, toPath] = rawPath.includes(" -> ") ? rawPath.split(" -> ") : [null, rawPath];

  return {
    fromPath,
    kind: classifyChange(statusCode),
    path: toPath,
    statusCode
  };
}

function shouldIgnoreChangePath(relativePath) {
  if (relativePath == null) {
    return false;
  }

  const normalized = String(relativePath || "").replace(/^"+|"+$/g, "");
  if (!normalized) {
    return false;
  }

  const ignoredPrefixes = [
    ".agent/",
    ".git/",
    ".npm-cache/",
    ".playwright-browsers/",
    ".playwright-home/",
    ".playwright/",
    ".next/",
    ".runtime/",
    "build/",
    "coverage/",
    "dist/",
    "node_modules/"
  ];

  if (ignoredPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  return normalized === ".DS_Store" || normalized.endsWith("/.DS_Store");
}

function countDiffLines(text) {
  let additions = 0;
  let deletions = 0;

  for (const line of String(text || "").split("\n")) {
    if (/^\+\+\+|^@@/.test(line)) {
      continue;
    }
    if (/^---/.test(line)) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return {
    additions,
    deletions
  };
}

function trimDiffPreview(text, maxChars = 12000) {
  if (text.length <= maxChars) {
    return {
      diffPreview: text,
      truncated: false
    };
  }

  return {
    diffPreview: `${text.slice(0, maxChars).trimEnd()}\n\n... diff truncated ...`,
    truncated: true
  };
}

async function runGit(cwd, args, gitCommandTimeoutMs) {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 1024 * 1024 * 8, timeout: gitCommandTimeoutMs });
  return stdout;
}

async function buildUntrackedDiff(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n");
  const preview = [`diff --git a/${relativePath} b/${relativePath}`, "new file mode 100644", "--- /dev/null", `+++ b/${relativePath}`]
    .concat(lines.slice(0, 160).map((line) => `+${line}`))
    .join("\n");

  return {
    additions: lines.length,
    deletions: 0,
    ...trimDiffPreview(preview)
  };
}

async function buildTrackedDiff(repoRoot, relativePath, gitCommandTimeoutMs) {
  const diff = await runGit(repoRoot, ["diff", "--no-ext-diff", "--no-color", "--unified=3", "HEAD", "--", relativePath], gitCommandTimeoutMs);
  const preview = trimDiffPreview(diff);
  const { additions, deletions } = countDiffLines(diff);

  return {
    additions,
    deletions,
    ...preview
  };
}

async function readUtf8Tail(filePath, maxBytes) {
  const handle = await open(filePath, "r");

  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    if (length === 0) {
      return "";
    }

    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);

    let text = buffer.toString("utf8");
    if (size > length) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
    }

    return text;
  } finally {
    await handle.close();
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRepoRelativePath(filePath, repoRoot) {
  const cleaned = String(filePath || "").replace(/[),"'`\]]+$/g, "");
  if (!cleaned) {
    return null;
  }

  const relative = path.relative(repoRoot, cleaned);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return relative.replace(/^\.\/+/, "");
}

async function extractSessionPathHints(threadPath, repoRoot, candidatePaths = [], sessionLogTailBytes) {
  if (!threadPath || !repoRoot) {
    return new Map();
  }

  try {
    const tail = await readUtf8Tail(threadPath, sessionLogTailBytes);
    if (!tail) {
      return new Map();
    }

    const absolutePathPattern = new RegExp(`${escapeRegExp(repoRoot)}/[^\\s"'` + "`" + `)\\]]+`, "g");
    const scores = new Map();

    for (const match of tail.matchAll(absolutePathPattern)) {
      const relativePath = normalizeRepoRelativePath(match[0], repoRoot);
      if (!relativePath || shouldIgnoreChangePath(relativePath)) {
        continue;
      }

      scores.set(relativePath, (scores.get(relativePath) || 0) + 1);
    }

    for (const candidate of candidatePaths) {
      const relativePath = String(candidate || "").replace(/^\.\/+/, "");
      if (!relativePath || shouldIgnoreChangePath(relativePath)) {
        continue;
      }

      const relativePattern = new RegExp(
        `(^|[^A-Za-z0-9_./-])${escapeRegExp(relativePath)}(?=$|[^A-Za-z0-9_./-])`,
        "g"
      );
      const matches = [...tail.matchAll(relativePattern)].length;
      if (matches > 0) {
        scores.set(relativePath, (scores.get(relativePath) || 0) + matches * 2);
      }
    }

    return scores;
  } catch {
    return new Map();
  }
}

function prioritizeParsedChanges(parsed, hintScores = new Map()) {
  const ranked = parsed
    .map((entry, index) => {
      const normalizedPath = String(entry.path || "");
      const pathScore = hintScores.get(entry.path) || 0;
      const fromScore = entry.fromPath ? hintScores.get(entry.fromPath) || 0 : 0;
      const codeSurfaceBoost = /^(src|public|test)\//.test(normalizedPath)
        ? 8
        : /\.(mjs|js|ts|tsx|css|html)$/i.test(normalizedPath)
          ? 5
          : 0;
      const rootAppBoost = /^(package\.json|README\.md|AGENTS\.md)$/i.test(normalizedPath) ? 2 : 0;
      const docsPenalty = /^docs\//.test(normalizedPath) ? -2 : 0;
      const trackedBoost = entry.kind === "untracked" ? 0 : 2;
      const sessionHits = pathScore + fromScore;

      return {
        ...entry,
        _index: index,
        _score:
          pathScore * 10 +
          fromScore * 6 +
          codeSurfaceBoost +
          rootAppBoost +
          docsPenalty +
          trackedBoost,
        _sessionHits: sessionHits,
        relevance:
          sessionHits > 0
            ? "mentioned in session"
            : codeSurfaceBoost > 0 || rootAppBoost > 0
              ? "repo hot path"
              : ""
      };
    })
    .sort((a, b) => b._score - a._score || a._index - b._index);

  return ranked.map(({ _index, _score, _sessionHits, ...entry }) => ({
    ...entry,
    sessionHits: _sessionHits
  }));
}

function parseUnifiedDiff(diffText) {
  const normalized = String(diffText || "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    return [];
  }

  const items = [];
  let current = null;

  function finalizeCurrent() {
    if (!current) {
      return;
    }

    const previewText = current.lines.join("\n").trim();
    const { additions, deletions } = countDiffLines(previewText);
    items.push({
      additions,
      deletions,
      diffPreview: trimDiffPreview(previewText).diffPreview,
      fromPath: current.fromPath,
      kind: current.kind,
      path: current.path,
      statusCode: current.statusCode
    });
    current = null;
  }

  for (const line of normalized.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finalizeCurrent();
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = {
        fromPath: match?.[1] || null,
        kind: "modified",
        lines: [line],
        path: match?.[2] || "current turn",
        statusCode: "M"
      };
      continue;
    }

    if (!current) {
      current = {
        fromPath: null,
        kind: "modified",
        lines: [],
        path: "current turn",
        statusCode: "M"
      };
    }

    if (line.startsWith("new file mode ")) {
      current.kind = "added";
      current.statusCode = "A";
    } else if (line.startsWith("deleted file mode ")) {
      current.kind = "deleted";
      current.statusCode = "D";
    } else if (line.startsWith("rename from ")) {
      current.kind = "renamed";
      current.fromPath = line.slice("rename from ".length).trim();
      current.statusCode = "R";
    } else if (line.startsWith("rename to ")) {
      current.path = line.slice("rename to ".length).trim();
    }

    current.lines.push(line);
  }

  finalizeCurrent();

  return items.filter((entry) => !shouldIgnoreChangePath(entry.path) && !shouldIgnoreChangePath(entry.fromPath));
}

export function createRepoChangesService({
  cacheTtlMs = 2500,
  gitCommandTimeoutMs = 4000,
  sessionLogTailBytes = 256 * 1024
} = {}) {
  const repoChangesCache = new Map();

  async function inspectRepoChanges(cwd, { threadPath = null } = {}) {
    try {
      const repoRoot = (await runGit(cwd, ["rev-parse", "--show-toplevel"], gitCommandTimeoutMs)).trim();
      const statusOutput = await runGit(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"], gitCommandTimeoutMs);
      const parsed = statusOutput
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map(parseStatusLine)
        .filter((entry) => !shouldIgnoreChangePath(entry.path) && !shouldIgnoreChangePath(entry.fromPath));
      const candidatePaths = [...new Set(parsed.flatMap((entry) => [entry.path, entry.fromPath]).filter(Boolean))];
      const hintScores = await extractSessionPathHints(threadPath, repoRoot, candidatePaths, sessionLogTailBytes);
      const rankedParsed = hintScores.size ? prioritizeParsedChanges(parsed, hintScores) : parsed;
      const relevantParsed = rankedParsed.filter((entry) => entry.sessionHits > 0);
      const overflowParsed = rankedParsed.filter((entry) => entry.sessionHits <= 0);
      const displayParsed = hintScores.size
        ? [...relevantParsed.slice(0, 8), ...overflowParsed.slice(0, 2)].slice(0, 10)
        : rankedParsed.slice(0, 12);

      const items = await Promise.all(
        displayParsed.map(async (entry) => {
          const diff =
            entry.kind === "untracked"
              ? await buildUntrackedDiff(repoRoot, entry.path)
              : await buildTrackedDiff(repoRoot, entry.path, gitCommandTimeoutMs);

          return {
            ...entry,
            ...diff
          };
        })
      );
      const focusPaths = rankedParsed
        .filter((entry) => entry.relevance)
        .slice(0, 4)
        .map((entry) => entry.path);
      const hiddenCount = Math.max(rankedParsed.length - items.length, 0);

      return {
        cwd,
        focusPaths,
        hiddenCount,
        items,
        repoRoot,
        source: hintScores.size ? "git_session" : "git",
        shownCount: items.length,
        supported: true,
        totalCount: rankedParsed.length
      };
    } catch {
      return {
        cwd,
        hiddenCount: 0,
        items: [],
        repoRoot: null,
        source: "git",
        shownCount: 0,
        supported: false,
        totalCount: 0
      };
    }
  }

  function repoChangesCacheKey(cwd, { threadPath = null } = {}) {
    return JSON.stringify({
      cwd: String(cwd || ""),
      threadPath: String(threadPath || "")
    });
  }

  function pruneRepoChangesCache() {
    const now = Date.now();
    for (const [key, value] of repoChangesCache.entries()) {
      if (value.promise) {
        continue;
      }

      if ((value.expiresAt || 0) <= now) {
        repoChangesCache.delete(key);
      }
    }
  }

  return {
    buildLiveTurnChanges({ cwd, diff, threadId, turnId }) {
      const items = parseUnifiedDiff(diff).map((entry) => ({
        ...entry,
        relevance: "current live turn",
        sessionHits: 0
      }));

      return {
        cwd,
        focusPaths: items.slice(0, 4).map((entry) => entry.path),
        hiddenCount: 0,
        items,
        repoRoot: cwd || null,
        source: "live_turn",
        shownCount: items.length,
        supported: true,
        threadId,
        totalCount: items.length,
        turnId
      };
    },

    async getCachedRepoChanges(cwd, { threadPath = null } = {}) {
      pruneRepoChangesCache();

      const normalizedCwd = String(cwd || "");
      const normalizedThreadPath = String(threadPath || "");
      const key = repoChangesCacheKey(normalizedCwd, { threadPath: normalizedThreadPath });
      const now = Date.now();
      const cached = repoChangesCache.get(key);

      if (cached?.value && (cached.expiresAt || 0) > now) {
        return cached.value;
      }

      if (cached?.promise) {
        return cached.promise;
      }

      const promise = inspectRepoChanges(normalizedCwd, { threadPath: normalizedThreadPath })
        .then((payload) => {
          repoChangesCache.set(key, {
            cwd: normalizedCwd,
            expiresAt: Date.now() + cacheTtlMs,
            threadPath: normalizedThreadPath,
            value: payload
          });
          return payload;
        })
        .catch((error) => {
          repoChangesCache.delete(key);
          throw error;
        });

      repoChangesCache.set(key, {
        cwd: normalizedCwd,
        expiresAt: now + cacheTtlMs,
        promise,
        threadPath: normalizedThreadPath,
        value: cached?.value || null
      });

      return promise;
    },

    invalidateRepoChangesCache({ cwd = "", threadPath = "" } = {}) {
      if (!cwd && !threadPath) {
        repoChangesCache.clear();
        return;
      }

      for (const [key, value] of repoChangesCache.entries()) {
        if (cwd && value.cwd !== cwd) {
          continue;
        }

        if (threadPath && value.threadPath !== threadPath) {
          continue;
        }

        repoChangesCache.delete(key);
      }
    }
  };
}
