import test from "node:test";
import assert from "node:assert/strict";

import {
  ARAZZO_DOC_PATH,
  DISCOVERY_MANIFEST_PATH,
  LLMS_TXT_PATH,
  OPENAPI_DOC_PATH,
  buildArazzoDocument,
  buildDiscoveryLinks,
  buildLlmsText,
  buildOpenApiDocument,
  buildWellKnownManifest
} from "../src/lib/discovery-docs.mjs";

test("discovery links stay stable and absolute when a base url is provided", () => {
  assert.deepEqual(
    buildDiscoveryLinks({ baseUrl: "http://127.0.0.1:4317" }),
    {
      arazzo: `http://127.0.0.1:4317${ARAZZO_DOC_PATH}`,
      llms: `http://127.0.0.1:4317${LLMS_TXT_PATH}`,
      manifest: `http://127.0.0.1:4317${DISCOVERY_MANIFEST_PATH}`,
      openapi: `http://127.0.0.1:4317${OPENAPI_DOC_PATH}`
    }
  );
});

test("well-known manifest points agents at the automation bootstrap path", () => {
  const manifest = buildWellKnownManifest({ baseUrl: "http://127.0.0.1:4317" });

  assert.equal(manifest.preferredBootstrapSurface, "agent");
  assert.equal(manifest.supportLevel, "advanced");
  assert.equal(
    manifest.bootstrap.defaultUrl,
    "http://127.0.0.1:4317/api/codex-app-server/bootstrap?surface=agent"
  );
  assert.ok(manifest.bootstrap.supportedSurfaces.agent.capabilities.includes("send_turn"));
  assert.ok(!manifest.bootstrap.supportedSurfaces.agent.capabilities.includes("use_companion"));
  assert.equal(manifest.bootstrap.supportedSurfaces.agent.supportLevel, "advanced");
  assert.equal(manifest.bootstrap.supportedSurfaces.remote.supportLevel, "primary");
});

test("openapi document exposes bearer auth and the core write flow", () => {
  const document = buildOpenApiDocument({ baseUrl: "http://127.0.0.1:4317" });

  assert.equal(document.openapi, "3.1.1");
  assert.equal(document.servers[0].url, "http://127.0.0.1:4317");
  assert.ok(document.components.securitySchemes.BearerAuth);
  assert.equal(
    document.paths["/api/codex-app-server/bootstrap"].get.operationId,
    "bootstrapSurface"
  );
  assert.equal(
    document.paths["/api/codex-app-server/turn"].post.operationId,
    "sendTurn"
  );
  assert.equal(
    document.paths["/api/codex-app-server/models"].get.operationId,
    "listModels"
  );
});

test("arazzo document references the openapi document and key workflows", () => {
  const document = buildArazzoDocument({ baseUrl: "http://127.0.0.1:4317" });

  assert.equal(document.arazzo, "1.0.1");
  assert.equal(document.sourceDescriptions[0].url, "http://127.0.0.1:4317/openapi.json");
  assert.deepEqual(
    document.workflows.map((workflow) => workflow.workflowId),
    ["bootstrapAndReadLiveState", "claimControlAndSendTurn", "watchLiveEvents"]
  );
});

test("llms text points agents at the discovery manifest and agent bootstrap", () => {
  const llms = buildLlmsText({ baseUrl: "http://127.0.0.1:4317" });

  assert.match(llms, /Discovery manifest: http:\/\/127\.0\.0\.1:4317\/\.well-known\/dextunnel\.json/);
  assert.match(llms, /Agent bootstrap URL: http:\/\/127\.0\.0\.1:4317\/api\/codex-app-server\/bootstrap\?surface=agent/);
  assert.match(llms, /Preferred: Authorization: Bearer <accessToken>/);
});
