import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  APP_SERVER_DRIFT_RUNBOOK_PATH,
  APP_SERVER_ITEM_TYPES,
  APP_SERVER_NOTIFICATION_METHODS,
  APP_SERVER_RPC_METHODS
} from "../src/lib/app-server-contract.mjs";

test("app-server drift runbook stays aligned with the coded dependency inventory", (t) => {
  const cwd = process.cwd();
  const runbookPath = path.join(cwd, APP_SERVER_DRIFT_RUNBOOK_PATH);
  if (!existsSync(runbookPath)) {
    t.skip("local private app-server drift runbook is not present in this clone");
    return;
  }
  const runbook = readFileSync(runbookPath, "utf8");

  for (const method of APP_SERVER_RPC_METHODS) {
    assert.match(runbook, new RegExp(method.replace("/", "\\/")));
  }

  for (const method of APP_SERVER_NOTIFICATION_METHODS) {
    assert.match(runbook, new RegExp(method.replace("/", "\\/")));
  }

  for (const itemType of APP_SERVER_ITEM_TYPES) {
    assert.match(runbook, new RegExp(itemType));
  }

  assert.match(runbook, /Graceful degradation stance/);
  assert.match(runbook, /Desktop trust confusion/);
});
