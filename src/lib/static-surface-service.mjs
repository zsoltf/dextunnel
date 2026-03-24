import path from "node:path";
import { readFile } from "node:fs/promises";

import { injectSurfaceBootstrap } from "./surface-access.mjs";
import { canServeSurfaceBootstrap } from "./surface-request-guard.mjs";

export function createStaticSurfaceService({
  exposeHostSurface = false,
  issueSurfaceBootstrap,
  mimeTypes = {},
  publicDir,
  readFileFn = readFile,
  sendJson
} = {}) {
  if (!publicDir) {
    throw new Error("createStaticSurfaceService requires a publicDir.");
  }
  if (typeof issueSurfaceBootstrap !== "function") {
    throw new Error("createStaticSurfaceService requires issueSurfaceBootstrap.");
  }
  if (typeof sendJson !== "function") {
    throw new Error("createStaticSurfaceService requires sendJson.");
  }

  async function serveStatic(req, res, pathname) {
    const relativePath = pathname === "/" ? "remote.html" : pathname.slice(1);
    const filePath = path.join(publicDir, relativePath);

    try {
      const ext = path.extname(filePath);
      const shouldInjectBootstrap =
        relativePath === "remote.html" || relativePath === "host.html";
      if (
        shouldInjectBootstrap &&
        !canServeSurfaceBootstrap({
          exposeHostSurface,
          localAddress: req.socket?.localAddress || "",
          pathname,
          remoteAddress: req.socket?.remoteAddress || ""
        })
      ) {
        sendJson(res, 403, {
          error: "Host surface is restricted to loopback unless DEXTUNNEL_EXPOSE_HOST_SURFACE is enabled."
        });
        return;
      }

      const data = shouldInjectBootstrap
        ? injectSurfaceBootstrap(
            await readFileFn(filePath, "utf8"),
            issueSurfaceBootstrap(relativePath === "host.html" ? "host" : "remote")
          )
        : await readFileFn(filePath);
      res.writeHead(200, {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        Pragma: "no-cache"
      });
      res.end(data);
    } catch (error) {
      sendJson(res, 404, {
        error: `Not found: ${relativePath}`,
        detail: error.message
      });
    }
  }

  return {
    serveStatic
  };
}
