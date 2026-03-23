import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createCodexAppServerBridge } from "../lib/codex-app-server-client.mjs";

const cwd = process.argv[2] || path.join(tmpdir(), "dextunnel-app-server-write-probe");
const bridge = createCodexAppServerBridge();

try {
  await mkdir(cwd, { recursive: true });
  const result = await bridge.sendText({
    cwd,
    text: "Reply with REMOTE_WRITE_OK only.",
    createThreadIfMissing: true,
    timeoutMs: 45000
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        cwd,
        mode: result.mode,
        threadId: result.thread.id,
        turnId: result.turn.id,
        turnStatus: result.turn.status,
        preview: result.snapshot.transcript.slice(-6)
      },
      null,
      2
    )
  );
} finally {
  await bridge.dispose();
}
