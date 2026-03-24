#!/usr/bin/env node

import {
  packageJsonPathFromImportMetaUrl,
  parseDextunnelCli,
  readPackageVersion,
  renderHelp
} from "../lib/dextunnel-cli.mjs";

const version = readPackageVersion({
  packageJsonPath: packageJsonPathFromImportMetaUrl(import.meta.url)
});

try {
  const command = parseDextunnelCli(process.argv.slice(2), { version });

  switch (command.kind) {
    case "help":
      console.log(command.text);
      break;
    case "version":
      console.log(command.text);
      break;
    case "doctor":
      await import("./doctor.mjs");
      break;
    case "serve":
      Object.assign(process.env, command.env);
      await import("../server.mjs");
      break;
    default:
      console.error(renderHelp({ version }));
      process.exitCode = 1;
      break;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error(renderHelp({ version }));
  process.exitCode = 1;
}
