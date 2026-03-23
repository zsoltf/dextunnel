import { createCodexAppServerBridge, mapThreadToCompanionSnapshot } from "../lib/codex-app-server-client.mjs";

const cwd = process.argv[2] || process.cwd();
const bridge = createCodexAppServerBridge();

try {
  const thread = await bridge.getLatestThreadForCwd(cwd);

  if (!thread) {
    console.log(JSON.stringify({ cwd, found: false }, null, 2));
    process.exit(0);
  }

  const snapshot = mapThreadToCompanionSnapshot(thread);
  console.log(
    JSON.stringify(
      {
        found: true,
        cwd,
        thread: snapshot.thread,
        transcriptCount: snapshot.transcript.length,
        preview: snapshot.transcript.slice(-8)
      },
      null,
      2
    )
  );
} finally {
  await bridge.dispose();
}
