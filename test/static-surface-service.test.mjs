import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { createStaticSurfaceService } from "../src/lib/static-surface-service.mjs";

function createResponseRecorder() {
  return {
    body: null,
    headers: null,
    statusCode: null,
    end(payload) {
      this.body = payload;
    },
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    }
  };
}

test("static surface service injects surface bootstrap into remote html", async () => {
  const publicDir = await mkdtemp(path.join(tmpdir(), "dextunnel-static-"));
  await writeFile(path.join(publicDir, "remote.html"), "<html><body>ok</body></html>", "utf8");

  const service = createStaticSurfaceService({
    issueSurfaceBootstrap: (surface) => ({
      accessToken: `${surface}-token`,
      surface
    }),
    mimeTypes: { ".html": "text/html" },
    publicDir,
    sendJson() {
      throw new Error("sendJson should not be called");
    }
  });

  const res = createResponseRecorder();
  await service.serveStatic(
    { socket: { remoteAddress: "127.0.0.1" } },
    res,
    "/remote.html"
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "text/html");
  assert.match(String(res.body), /window\.__DEXTUNNEL_SURFACE_BOOTSTRAP__/);
  assert.match(String(res.body), /"accessToken":"remote-token"/);
});

test("static surface service blocks host bootstrap for non-loopback clients by default", async () => {
  const publicDir = await mkdtemp(path.join(tmpdir(), "dextunnel-static-"));
  await writeFile(path.join(publicDir, "host.html"), "<html><body>host</body></html>", "utf8");
  const calls = [];
  const service = createStaticSurfaceService({
    issueSurfaceBootstrap: () => ({ accessToken: "host-token", surface: "host" }),
    mimeTypes: { ".html": "text/html" },
    publicDir,
    sendJson(...args) {
      calls.push(args);
    }
  });

  await service.serveStatic(
    { socket: { remoteAddress: "192.168.64.10" } },
    createResponseRecorder(),
    "/host.html"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 403);
  assert.match(calls[0][2].error, /Host surface is restricted to loopback/);
});

test("static surface service serves non-bootstrap assets without modification", async () => {
  const publicDir = await mkdtemp(path.join(tmpdir(), "dextunnel-static-"));
  await writeFile(path.join(publicDir, "app.js"), "console.log('ok');\n", "utf8");

  const service = createStaticSurfaceService({
    issueSurfaceBootstrap: () => ({ accessToken: "unused", surface: "remote" }),
    mimeTypes: { ".js": "text/javascript" },
    publicDir,
    sendJson() {
      throw new Error("sendJson should not be called");
    }
  });

  const res = createResponseRecorder();
  await service.serveStatic(
    { socket: { remoteAddress: "127.0.0.1" } },
    res,
    "/app.js"
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "text/javascript");
  assert.equal(String(res.body), "console.log('ok');\n");
});
