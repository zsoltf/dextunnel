import { createCodexAppServerBridge } from "../lib/codex-app-server-client.mjs";
import { buildInstallPreflight } from "../lib/install-preflight.mjs";
import { createRuntimeConfig } from "../lib/runtime-config.mjs";

const runtimeConfig = createRuntimeConfig({
  cwd: process.cwd(),
  env: process.env,
  importMetaUrl: import.meta.url
});

const bridge = createCodexAppServerBridge({
  binaryPath: runtimeConfig.codexBinaryPath,
  listenUrl: runtimeConfig.appServerListenUrl
});

try {
  const preflight = await buildInstallPreflight({
    codexAppServer: bridge,
    cwd: runtimeConfig.cwd,
    runtimeConfig,
    warmup: true
  });

  console.log(`Dextunnel doctor: ${preflight.status.toUpperCase()}`);
  console.log(preflight.summary);
  console.log("");
  for (const check of preflight.checks) {
    console.log(`- ${check.label}: ${check.detail}`);
  }

  if (preflight.appServer.startupLogTail.length) {
    console.log("");
    console.log("Recent Codex startup log:");
    for (const line of preflight.appServer.startupLogTail) {
      console.log(`  ${line}`);
    }
  }

  console.log("");
  console.log("Next steps:");
  for (const step of preflight.nextSteps) {
    console.log(`- ${step}`);
  }

  process.exit(preflight.status === "error" ? 1 : 0);
} finally {
  await bridge.dispose();
}
