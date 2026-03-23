import {
  clearLaunchAttestations,
  computeLaunchFingerprint,
  defaultLaunchStatusPath,
  writeLaunchAttestation
} from "../lib/launch-release-bar.mjs";

const command = process.argv[2];
const statusPath = defaultLaunchStatusPath();

if (command === "clear") {
  await clearLaunchAttestations({ statusPath });
  console.log(`Cleared launch attestations at ${statusPath}`);
  process.exit(0);
}

if (command !== "automated-pass" && command !== "manual-pass") {
  console.error("Usage: node src/bin/launch-attest.mjs <automated-pass|manual-pass|clear>");
  process.exit(1);
}

const kind = command === "automated-pass" ? "automated" : "manual";
const fingerprint = computeLaunchFingerprint();
const state = await writeLaunchAttestation({
  kind,
  statusPath,
  fingerprint
});

console.log(
  `${kind === "automated" ? "Recorded automated launch pass" : "Recorded manual launch pass"} for ${fingerprint.fingerprint}`
);
console.log(`Attestations: ${statusPath}`);
if (state.automated) {
  console.log(`Automated: ${state.automated.recordedAt}`);
}
if (state.manual) {
  console.log(`Manual: ${state.manual.recordedAt}`);
}
