import {
  computeLaunchFingerprint,
  defaultLaunchStatusPath,
  deriveLaunchBar,
  readLaunchAttestation
} from "../lib/launch-release-bar.mjs";

const json = process.argv.includes("--json");

const statusPath = defaultLaunchStatusPath();
const fingerprint = computeLaunchFingerprint();
const state = await readLaunchAttestation({ statusPath });
const payload = {
  ...deriveLaunchBar({ fingerprint: fingerprint.fingerprint, state }),
  fingerprint: fingerprint.fingerprint,
  statusPath
};

if (json) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.log(`Dextunnel local launch status: ${payload.status}`);
console.log(payload.message);
console.log("");
console.log("Accepted limitations:");
for (const line of payload.acceptedLimitations) {
  console.log(`- ${line}`);
}
console.log("");
console.log("Launch references:");
for (const doc of payload.docs) {
  console.log(`- ${doc}`);
}
console.log("");
console.log("Attestation model:");
console.log("- automated pass is recorded only by npm run launch:check for the current repo fingerprint");
console.log("- manual pass is a human attestation recorded by npm run launch:attest-manual");
console.log("");
console.log("Manual checks:");
for (const line of payload.requiredManualChecks) {
  console.log(`- ${line}`);
}

if (payload.staleAutomated || payload.staleManual) {
  console.log("");
  console.log(`Attestations: ${payload.statusPath}`);
}
