import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageJsonPathFromImportMetaUrl(importMetaUrl) {
  const scriptPath = fileURLToPath(importMetaUrl);
  return path.resolve(path.dirname(scriptPath), "../../package.json");
}

export function readPackageVersion({ packageJsonPath }) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return String(packageJson.version || "0.0.0");
}

export function renderHelp({ version }) {
  return [
    `Dextunnel ${version}`,
    "",
    "Usage:",
    "  dextunnel serve [--host <host>] [--port <port>] [--network] [--expose-host-surface]",
    "  dextunnel doctor",
    "  dextunnel --help",
    "  dextunnel --version",
    "",
    "Commands:",
    "  serve   Start the local Dextunnel bridge (default command).",
    "  doctor  Run the local Codex bridge preflight checks.",
    "",
    "Options:",
    "  --host <host>              Bind the bridge to a specific host.",
    "  --port <port>              Bind the bridge to a specific port.",
    "  --network                  Bind to 0.0.0.0 for LAN or Tailscale access.",
    "  --expose-host-surface      Allow the host surface beyond loopback.",
    "  -h, --help                 Show this help message.",
    "  -v, --version              Show the package version."
  ].join("\n");
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return String(port);
}

export function parseServeArgs(args, { version }) {
  const env = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--help":
      case "-h":
        return { kind: "help", text: renderHelp({ version }) };
      case "--version":
      case "-v":
        return { kind: "version", text: version };
      case "--network":
        env.DEXTUNNEL_HOST = "0.0.0.0";
        break;
      case "--expose-host-surface":
        env.DEXTUNNEL_EXPOSE_HOST_SURFACE = "1";
        break;
      case "--host": {
        const value = args[index + 1];
        if (!value) {
          throw new Error("Missing value for --host");
        }
        env.DEXTUNNEL_HOST = value;
        index += 1;
        break;
      }
      case "--port": {
        const value = args[index + 1];
        if (!value) {
          throw new Error("Missing value for --port");
        }
        env.PORT = parsePort(value);
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { kind: "serve", env };
}

export function parseDextunnelCli(argv, { version }) {
  const args = [...argv];
  const first = args[0];

  if (!first) {
    return { kind: "serve", env: {} };
  }

  switch (first) {
    case "serve":
      return parseServeArgs(args.slice(1), { version });
    case "doctor":
      if (args.length > 1) {
        throw new Error("The doctor command does not accept extra arguments.");
      }
      return { kind: "doctor" };
    case "help":
    case "--help":
    case "-h":
      return { kind: "help", text: renderHelp({ version }) };
    case "version":
    case "--version":
    case "-v":
      return { kind: "version", text: version };
    default:
      if (first.startsWith("-")) {
        return parseServeArgs(args, { version });
      }
      throw new Error(`Unknown command: ${first}`);
  }
}
