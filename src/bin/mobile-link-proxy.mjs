import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import { URL } from "node:url";

import {
  resolveMobileNetworkProfile,
  withNetworkJitter
} from "../lib/mobile-network-profile.mjs";

function printUsage() {
  console.log(
    "Usage: node src/bin/mobile-link-proxy.mjs --target-base-url http://127.0.0.1:4317 [--listen-port 4417] [--profile weak-mobile|weak-mobile-reconnect]"
  );
}

function parseArgs(argv) {
  const options = {
    listenHost: "127.0.0.1",
    listenPort: 4417,
    profile: "weak-mobile",
    targetBaseUrl: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--target-base-url" && argv[index + 1]) {
      options.targetBaseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--listen-port" && argv[index + 1]) {
      options.listenPort = Number(argv[index + 1]) || options.listenPort;
      index += 1;
      continue;
    }
    if (arg === "--listen-host" && argv[index + 1]) {
      options.listenHost = argv[index + 1] || options.listenHost;
      index += 1;
      continue;
    }
    if (arg === "--profile" && argv[index + 1]) {
      options.profile = argv[index + 1] || options.profile;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.targetBaseUrl) {
    throw new Error("--target-base-url is required.");
  }

  const profile = resolveMobileNetworkProfile(options.profile);
  if (!profile) {
    throw new Error(`Unknown network profile: ${options.profile}`);
  }

  return {
    ...options,
    profile
  };
}

function delay(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : null;
}

async function pipeWithThrottle(readable, writable, bytesPerSecond, dropAfterMs = null) {
  let dropped = false;
  let dropTimer = null;

  if (dropAfterMs && Number.isFinite(dropAfterMs) && dropAfterMs > 0) {
    dropTimer = setTimeout(() => {
      dropped = true;
      try {
        readable.destroy(new Error("Synthetic weak-network stream drop."));
      } catch {
        // Ignore teardown failures.
      }
      try {
        writable.destroy();
      } catch {
        // Ignore teardown failures.
      }
    }, dropAfterMs);
  }

  try {
    for await (const chunk of readable) {
      if (dropped || writable.destroyed) {
        return;
      }
      if (!writable.write(chunk)) {
        await once(writable, "drain");
      }
      if (bytesPerSecond && bytesPerSecond > 0) {
        const waitMs = Math.ceil((Buffer.byteLength(chunk) / bytesPerSecond) * 1000);
        if (waitMs > 0) {
          await delay(waitMs);
        }
      }
    }
    if (!writable.destroyed) {
      writable.end();
    }
  } finally {
    if (dropTimer) {
      clearTimeout(dropTimer);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetBaseUrl = new URL(options.targetBaseUrl);
  const clientForTarget = targetBaseUrl.protocol === "https:" ? https : http;

  const server = http.createServer(async (req, res) => {
    try {
      const body = await readRequestBody(req);
      const requestDelayMs = withNetworkJitter(options.profile.requestDelayMs, options.profile.jitterMs);
      const responseDelayMs = withNetworkJitter(options.profile.responseDelayMs, options.profile.jitterMs);
      await delay(requestDelayMs);

      const targetUrl = new URL(req.url || "/", targetBaseUrl);
      const upstream = clientForTarget.request(targetUrl, {
        headers: {
          ...req.headers,
          host: targetBaseUrl.host
        },
        method: req.method || "GET"
      });

      upstream.on("response", async (upstreamRes) => {
        await delay(responseDelayMs);
        const responseHeaders = { ...upstreamRes.headers };
        delete responseHeaders["content-length"];
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
        const isSse = String(upstreamRes.headers["content-type"] || "").includes("text/event-stream");
        await pipeWithThrottle(
          upstreamRes,
          res,
          options.profile.downstreamBytesPerSecond,
          isSse ? options.profile.dropSseAfterMs : null
        );
      });

      upstream.on("error", (error) => {
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        try {
          res.destroy(error);
        } catch {
          // Ignore teardown failures.
        }
      });

      if (body?.length) {
        if (options.profile.upstreamBytesPerSecond > 0) {
          const waitMs = Math.ceil((body.length / options.profile.upstreamBytesPerSecond) * 1000);
          upstream.write(body);
          if (waitMs > 0) {
            await delay(waitMs);
          }
          upstream.end();
        } else {
          upstream.end(body);
        }
      } else {
        upstream.end();
      }
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listenPort, options.listenHost, resolve);
  });

  const proxyUrl = `http://${options.listenHost}:${options.listenPort}`;
  console.log(
    `[mobile-link-proxy] listening=${proxyUrl} target=${targetBaseUrl.origin} profile=${options.profile.name}`
  );

  function shutdown(code = 0) {
    server.close(() => {
      process.exit(code);
    });
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main().catch((error) => {
  console.error(`[mobile-link-proxy] failed: ${error.message}`);
  process.exit(1);
});

