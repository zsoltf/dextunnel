import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function printUsage() {
  console.log(
    "Usage: node src/bin/mobile-proof.mjs [--base-url http://127.0.0.1:4317] [--surface remote|host] [--transport-probe-send] [--no-native-probe-send] [--network-profile weak-mobile|weak-mobile-reconnect] [--proxy-port 4417]"
  );
}

function parseArgs(argv) {
  const options = {
    baseUrl: "http://127.0.0.1:4317",
    nativeProbeSend: true,
    networkProfile: "",
    proxyPort: 4417,
    surface: "remote"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--base-url") {
      options.baseUrl = argv[index + 1] || options.baseUrl;
      index += 1;
      continue;
    }

    if (arg === "--surface") {
      options.surface = argv[index + 1] || options.surface;
      index += 1;
      continue;
    }

    if (arg === "--network-profile") {
      options.networkProfile = argv[index + 1] || options.networkProfile;
      index += 1;
      continue;
    }

    if (arg === "--proxy-port") {
      options.proxyPort = Number(argv[index + 1]) || options.proxyPort;
      index += 1;
      continue;
    }

    if (arg === "--no-probe-send" || arg === "--no-native-probe-send") {
      options.nativeProbeSend = false;
      continue;
    }

    if (arg === "--transport-probe-send") {
      options.transportProbeSend = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited via signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
        return;
      }

      resolve();
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const nativeDir = path.join(repoRoot, "native", "apple");
  let effectiveBaseUrl = options.baseUrl;
  let proxyChild = null;

  if (options.networkProfile) {
    const proxyScript = path.join(repoRoot, "src", "bin", "mobile-link-proxy.mjs");
    proxyChild = spawn(process.execPath, [
      proxyScript,
      "--target-base-url",
      options.baseUrl,
      "--listen-port",
      String(options.proxyPort),
      "--profile",
      options.networkProfile
    ], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit"
    });

    proxyChild.on("error", (error) => {
      console.error(`[mobile-proof] proxy failed: ${error.message}`);
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    effectiveBaseUrl = `http://127.0.0.1:${options.proxyPort}`;
  }

  const transportArgs = [
    path.join(repoRoot, "src", "bin", "mobile-transport-smoke.mjs"),
    "--base-url",
    effectiveBaseUrl,
    "--surface",
    options.surface
  ];
  if (options.transportProbeSend) {
    transportArgs.push("--probe-send");
  }

  const nativeArgs = [
    "run",
    "DextunnelNativeBridgeSmoke",
    "--base-url",
    effectiveBaseUrl,
    "--surface",
    options.surface
  ];
  if (options.nativeProbeSend) {
    nativeArgs.push("--probe-send");
  }

  try {
    console.log(`[mobile-proof] transport smoke -> ${effectiveBaseUrl} (${options.surface})`);
    await runCommand(process.execPath, transportArgs, { cwd: repoRoot });
    console.log("[mobile-proof] native bridge smoke");
    await runCommand("swift", nativeArgs, { cwd: nativeDir });
    console.log("[mobile-proof] complete");
  } finally {
    if (proxyChild && proxyChild.exitCode == null) {
      proxyChild.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(`[mobile-proof] failed: ${error.message}`);
  process.exit(1);
});
