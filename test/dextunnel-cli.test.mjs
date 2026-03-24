import test from "node:test";
import assert from "node:assert/strict";

import { parseDextunnelCli, renderHelp } from "../src/lib/dextunnel-cli.mjs";

test("cli defaults to serve with no env overrides", () => {
  assert.deepEqual(parseDextunnelCli([], { version: "0.1.0" }), {
    kind: "serve",
    env: {}
  });
});

test("cli maps network and explicit port into serve env", () => {
  assert.deepEqual(
    parseDextunnelCli(["serve", "--network", "--port", "4417"], { version: "0.1.0" }),
    {
      kind: "serve",
      env: {
        DEXTUNNEL_HOST: "0.0.0.0",
        PORT: "4417"
      }
    }
  );
});

test("cli treats bare flags as serve options", () => {
  assert.deepEqual(
    parseDextunnelCli(["--host", "0.0.0.0", "--expose-host-surface"], { version: "0.1.0" }),
    {
      kind: "serve",
      env: {
        DEXTUNNEL_EXPOSE_HOST_SURFACE: "1",
        DEXTUNNEL_HOST: "0.0.0.0"
      }
    }
  );
});

test("cli surfaces help and version commands", () => {
  assert.equal(parseDextunnelCli(["--version"], { version: "0.1.0" }).text, "0.1.0");
  assert.match(renderHelp({ version: "0.1.0" }), /Usage:/);
  assert.match(parseDextunnelCli(["doctor"], { version: "0.1.0" }).kind, /doctor/);
});

test("cli rejects invalid commands and ports", () => {
  assert.throws(
    () => parseDextunnelCli(["ship-it"], { version: "0.1.0" }),
    /Unknown command/
  );
  assert.throws(
    () => parseDextunnelCli(["serve", "--port", "0"], { version: "0.1.0" }),
    /Invalid port/
  );
});
