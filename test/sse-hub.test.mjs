import test from "node:test";
import assert from "node:assert/strict";

import { createSseHub } from "../src/lib/sse-hub.mjs";

function createFakeResponse() {
  return {
    chunks: [],
    headers: null,
    statusCode: null,
    write(chunk) {
      this.chunks.push(chunk);
    },
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    }
  };
}

test("sse hub opens with initial events and broadcasts later updates", () => {
  const hub = createSseHub();
  const first = createFakeResponse();
  const second = createFakeResponse();

  hub.open(first, [
    { event: "snapshot", payload: { ok: true } },
    { event: "live", payload: { room: "#dextunnel" } }
  ]);
  hub.open(second, []);
  hub.broadcast("live", { status: "online" });

  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["Content-Type"], "text/event-stream");
  assert.match(first.chunks.join(""), /event: snapshot/);
  assert.match(first.chunks.join(""), /event: live/);
  assert.match(second.chunks.join(""), /status/);
});

test("sse hub closes a client cleanly", () => {
  const hub = createSseHub();
  const first = createFakeResponse();
  const second = createFakeResponse();

  hub.open(first, []);
  hub.open(second, []);
  hub.close(first);
  hub.broadcast("live", { status: "still-open" });

  assert.equal(first.chunks.length, 0);
  assert.match(second.chunks.join(""), /still-open/);
});
