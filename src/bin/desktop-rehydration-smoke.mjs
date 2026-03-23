import process from "node:process";

import { runDesktopRehydrationSmoke } from "../lib/desktop-rehydration-smoke.mjs";

function printUsage() {
  console.log("Usage: node src/bin/desktop-rehydration-smoke.mjs --thread-id <id> [--cwd <path>] [--skip-probe] [--json]");
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    includeProbe: true,
    json: false,
    threadId: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--thread-id") {
      options.threadId = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (value === "--cwd") {
      options.cwd = argv[index + 1] || process.cwd();
      index += 1;
      continue;
    }
    if (value === "--skip-probe") {
      options.includeProbe = false;
      continue;
    }
    if (value === "--json") {
      options.json = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return options;
}

function printTextReport(report) {
  console.log(`Desktop rehydration smoke for thread ${report.threadId}`);
  console.log(`cwd: ${report.cwd}`);
  console.log("");
  if (report.probe.included) {
    console.log(`Probe: ${report.probe.status}`);
    console.log(`- prompt: ${report.probe.prompt}`);
    console.log(`- ack: ${report.probe.ack}`);
    if (report.probe.turnId) {
      console.log(`- turn: ${report.probe.turnId} (${report.probe.turnStatus || "unknown"})`);
    }
    if (report.probe.included) {
      console.log(`- prompt visible in app-server readback: ${report.probe.promptVisible === true ? "yes" : report.probe.promptVisible === false ? "no" : "n/a"}`);
      console.log(`- ack visible in app-server readback: ${report.probe.ackVisible === true ? "yes" : report.probe.ackVisible === false ? "no" : "n/a"}`);
    }
    console.log("");
  }

  console.log("Attempts:");
  for (const attempt of report.attempts) {
    console.log(`- [${attempt.status}] ${attempt.label}`);
    console.log(`  expected desktop outcome: ${attempt.expectedDesktopOutcome}`);
    if (attempt.detail) {
      console.log(`  detail: ${attempt.detail}`);
    }
  }

  console.log("");
  console.log("Manual checks:");
  for (const check of report.manualChecks) {
    console.log(`- ${check}`);
  }
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  printUsage();
  process.exit(1);
}

if (options.help) {
  printUsage();
  process.exit(0);
}

if (!options.threadId) {
  printUsage();
  process.exit(1);
}

const report = await runDesktopRehydrationSmoke({
  cwd: options.cwd,
  includeProbe: options.includeProbe,
  threadId: options.threadId
});

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

printTextReport(report);
