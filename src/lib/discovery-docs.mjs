import { SURFACE_CAPABILITIES } from "./surface-access.mjs";

export const DISCOVERY_MANIFEST_PATH = "/.well-known/dextunnel.json";
export const OPENAPI_DOC_PATH = "/openapi.json";
export const ARAZZO_DOC_PATH = "/arazzo.json";
export const LLMS_TXT_PATH = "/llms.txt";

function normalizeBaseUrl(baseUrl = "") {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function joinUrl(baseUrl, pathname) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return pathname;
  }
  return `${normalizedBaseUrl}${pathname}`;
}

function bootstrapUrl(baseUrl, surface = "agent") {
  const query = new URLSearchParams({ surface }).toString();
  return `${joinUrl(baseUrl, "/api/codex-app-server/bootstrap")}?${query}`;
}

function buildSurfaceDescriptions(baseUrl) {
  return {
    agent: {
      bootstrapUrl: bootstrapUrl(baseUrl, "agent"),
      capabilities: [...SURFACE_CAPABILITIES.agent],
      description:
        "Advanced automation surface with room read/write, control, refresh, and interaction handling.",
      intendedClients: ["agents", "scripts", "local automation"],
      supportLevel: "advanced"
    },
    remote: {
      bootstrapUrl: bootstrapUrl(baseUrl, "remote"),
      capabilities: [...SURFACE_CAPABILITIES.remote],
      description:
        "Human remote-operator surface used by the web companion UI. Includes companion and agent-room features.",
      intendedClients: ["browser remote", "mobile operator UI"],
      supportLevel: "primary"
    },
    host: {
      bootstrapUrl: bootstrapUrl(baseUrl, "host"),
      capabilities: [...SURFACE_CAPABILITIES.host],
      description:
        "Desktop-adjacent host surface. Restricted to loopback unless DEXTUNNEL_EXPOSE_HOST_SURFACE is enabled.",
      intendedClients: ["local host UI"],
      supportLevel: "primary"
    }
  };
}

export function buildDiscoveryLinks({ baseUrl = "" } = {}) {
  return {
    arazzo: joinUrl(baseUrl, ARAZZO_DOC_PATH),
    llms: joinUrl(baseUrl, LLMS_TXT_PATH),
    manifest: joinUrl(baseUrl, DISCOVERY_MANIFEST_PATH),
    openapi: joinUrl(baseUrl, OPENAPI_DOC_PATH)
  };
}

export function buildWellKnownManifest({ baseUrl = "" } = {}) {
  const links = buildDiscoveryLinks({ baseUrl });
  return {
    schemaVersion: "1.0",
    id: "dextunnel-bridge-api",
    name: "Dextunnel Bridge API",
    description:
      "Local-first bridge API for advanced automation and local integrations around live Codex threads over HTTP JSON and SSE.",
    preferredBootstrapSurface: "agent",
    supportLevel: "advanced",
    apiVersion: "2026-03-23",
    links,
    bootstrap: {
      defaultUrl: bootstrapUrl(baseUrl, "agent"),
      pathTemplate: "/api/codex-app-server/bootstrap?surface={surface}",
      supportedSurfaces: buildSurfaceDescriptions(baseUrl)
    },
    auth: {
      preferred: {
        scheme: "bearer",
        usage: "Authorization: Bearer <accessToken>"
      },
      accepted: [
        "Authorization: Bearer <accessToken>",
        "x-dextunnel-surface-token: <accessToken>",
        "surfaceToken=<accessToken> query parameter for compatibility, mainly for SSE or browser EventSource clients"
      ]
    },
    transports: {
      http: {
        apiBase: joinUrl(baseUrl, "/api"),
        format: "json"
      },
      sse: {
        eventTypes: ["snapshot", "live"],
        url: joinUrl(baseUrl, "/api/stream")
      }
    },
    recommendedWorkflow: [
      "Fetch this manifest.",
      "Call the agent bootstrap URL to obtain a signed access token.",
      "Send the token as Authorization: Bearer <accessToken> on subsequent API calls.",
      "Read /api/codex-app-server/live-state for the current selected thread.",
      "Claim control if you plan to send a turn into an active remote-controlled thread.",
      "Subscribe to /api/stream for live updates."
    ]
  };
}

function securitySchemesDescription() {
  return "Bootstrap a token from GET /api/codex-app-server/bootstrap?surface=agent, then send it as Authorization: Bearer <accessToken>.";
}

function createOpenApiSchemas() {
  return {
    BootstrapToken: {
      type: "object",
      additionalProperties: false,
      required: ["accessToken", "capabilities", "clientId", "expiresAt", "issuedAt", "surface"],
      properties: {
        accessToken: { type: "string" },
        capabilities: {
          type: "array",
          items: { type: "string" }
        },
        clientId: { type: "string" },
        expiresAt: { type: "string", format: "date-time" },
        issuedAt: { type: "string", format: "date-time" },
        surface: {
          type: "string",
          enum: ["agent", "host", "remote"]
        }
      }
    },
    CheckEntry: {
      type: "object",
      additionalProperties: true,
      properties: {
        detail: { type: "string" },
        id: { type: "string" },
        label: { type: "string" },
        severity: {
          type: "string",
          enum: ["error", "ready", "warning"]
        }
      }
    },
    DiscoveryLinks: {
      type: "object",
      additionalProperties: false,
      properties: {
        arazzo: { type: "string" },
        llms: { type: "string" },
        manifest: { type: "string" },
        openapi: { type: "string" }
      }
    },
    Preflight: {
      type: "object",
      additionalProperties: true,
      properties: {
        appServer: {
          type: "object",
          additionalProperties: true
        },
        checks: {
          type: "array",
          items: { $ref: "#/components/schemas/CheckEntry" }
        },
        codexBinary: {
          type: "object",
          additionalProperties: true
        },
        links: { $ref: "#/components/schemas/DiscoveryLinks" },
        nextSteps: {
          type: "array",
          items: { type: "string" }
        },
        runtime: {
          type: "object",
          additionalProperties: true
        },
        status: {
          type: "string",
          enum: ["error", "ready", "warning"]
        },
        summary: { type: "string" },
        workspace: {
          type: "object",
          additionalProperties: true
        }
      }
    },
    LiveState: {
      type: "object",
      additionalProperties: true,
      properties: {
        pendingInteraction: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        selectedAgentRoom: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        selectedAttachments: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        },
        selectedChannel: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        selectedCompanion: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        selectedProjectCwd: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        selectedThreadId: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        selectedThreadSnapshot: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        status: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        threads: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        },
        turnDiff: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        }
      }
    },
    BridgeStatus: {
      type: "object",
      additionalProperties: true,
      properties: {
        diagnostics: {
          type: "array",
          items: {
            type: "string"
          }
        },
        lastControlEvent: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        lastInteraction: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        lastSelectionEvent: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        lastSurfaceEvent: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        lastWrite: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        watcherConnected: {
          anyOf: [{ type: "boolean" }, { type: "null" }]
        }
      }
    },
    TranscriptHistoryPage: {
      type: "object",
      additionalProperties: true,
      properties: {
        hasMore: { type: "boolean" },
        items: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        },
        nextBeforeIndex: {
          anyOf: [{ type: "integer" }, { type: "null" }]
        },
        totalCount: { type: "integer" }
      }
    },
    ThreadsResponse: {
      type: "object",
      additionalProperties: true,
      properties: {
        cwd: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        data: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        }
      }
    },
    ThreadSnapshotResponse: {
      type: "object",
      additionalProperties: true,
      properties: {
        found: { type: "boolean" },
        snapshot: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        threadId: {
          anyOf: [{ type: "string" }, { type: "null" }]
        }
      }
    },
    LatestThreadResponse: {
      type: "object",
      additionalProperties: true,
      properties: {
        cwd: { type: "string" },
        found: { type: "boolean" },
        snapshot: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        }
      }
    },
    StateEnvelope: {
      type: "object",
      additionalProperties: true,
      properties: {
        ok: { type: "boolean" },
        state: { $ref: "#/components/schemas/LiveState" }
      }
    },
    SelectionRequest: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        threadId: {
          anyOf: [{ type: "string" }, { type: "null" }]
        }
      }
    },
    CreateThreadRequest: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: {
          anyOf: [{ type: "string" }, { type: "null" }]
        }
      }
    },
    ControlRequest: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["claim", "release"]
        },
        reason: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        threadId: {
          anyOf: [{ type: "string" }, { type: "null" }]
        }
      }
    },
    InteractionRequest: {
      type: "object",
      additionalProperties: true,
      description:
        "Pass through the pending interaction response payload for the selected thread. Fields depend on the interaction kind."
    },
    OpenInCodexRequest: {
      type: "object",
      additionalProperties: false,
      properties: {
        threadId: {
          anyOf: [{ type: "string" }, { type: "null" }]
        }
      }
    },
    SendTurnRequest: {
      type: "object",
      additionalProperties: false,
      properties: {
        attachments: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        },
        createThreadIfMissing: { type: "boolean" },
        cwd: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        effort: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        model: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        reasoningEffort: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        reasoning_effort: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        text: { type: "string" },
        threadId: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        timeoutMs: { type: "integer" }
      }
    },
    SendTurnResponse: {
      type: "object",
      additionalProperties: true,
      properties: {
        mode: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        ok: { type: "boolean" },
        snapshot: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        thread: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        },
        turn: {
          anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }]
        }
      }
    },
    ModelListResponse: {
      type: "object",
      additionalProperties: true,
      properties: {
        data: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true
          }
        },
        nextCursor: {
          anyOf: [{ type: "string" }, { type: "null" }]
        }
      }
    },
    CompanionRequest: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string" },
        advisorId: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        threadId: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        wakeKey: {
          anyOf: [{ type: "string" }, { type: "null" }]
        }
      }
    },
    AgentRoomRequest: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string" },
        memberIds: {
          anyOf: [
            {
              type: "array",
              items: { type: "string" }
            },
            { type: "null" }
          ]
        },
        text: { type: "string" },
        threadId: {
          anyOf: [{ type: "string" }, { type: "null" }]
        }
      }
    },
    MessageEnvelope: {
      type: "object",
      additionalProperties: true,
      properties: {
        message: {
          anyOf: [{ type: "string" }, { type: "null" }]
        },
        ok: { type: "boolean" },
        state: { $ref: "#/components/schemas/LiveState" }
      }
    },
    ErrorResponse: {
      type: "object",
      additionalProperties: true,
      required: ["error"],
      properties: {
        error: { type: "string" },
        state: {
          anyOf: [{ $ref: "#/components/schemas/LiveState" }, { type: "null" }]
        },
        status: {
          anyOf: [{ type: "string" }, { type: "null" }]
        }
      }
    }
  };
}

function securedPath(operation) {
  return {
    ...operation,
    security: [{ BearerAuth: [] }, { SurfaceTokenHeader: [] }]
  };
}

function securedStreamPath(operation) {
  return {
    ...operation,
    security: [{ BearerAuth: [] }, { SurfaceTokenHeader: [] }, { SurfaceTokenQuery: [] }]
  };
}

export function buildOpenApiDocument({ baseUrl = "" } = {}) {
  return {
    openapi: "3.1.1",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "Dextunnel Bridge API",
      version: "2026-03-23",
      summary: "HTTP JSON and SSE bridge for reading and steering live Codex threads.",
      description:
        "Bootstrap a signed surface token, then use it to read live state, claim control, send turns, resolve interactions, and subscribe to server-sent updates."
    },
    servers: [
      {
        url: normalizeBaseUrl(baseUrl) || "/",
        description: "Current Dextunnel bridge instance"
      }
    ],
    tags: [
      { name: "discovery" },
      { name: "read" },
      { name: "control" },
      { name: "write" },
      { name: "stream" }
    ],
    paths: {
      "/api/preflight": {
        get: {
          tags: ["discovery"],
          operationId: "getPreflight",
          summary: "Inspect local Dextunnel readiness without authentication.",
          parameters: [
            {
              in: "query",
              name: "warmup",
              schema: { type: "string", enum: ["0", "1"] },
              description:
                "Use warmup=0 to skip thread-list warmup and return a lighter local setup check."
            }
          ],
          responses: {
            200: {
              description: "Install preflight payload.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Preflight" }
                }
              }
            }
          }
        }
      },
      "/api/codex-app-server/bootstrap": {
        get: {
          tags: ["discovery"],
          operationId: "bootstrapSurface",
          summary: "Issue a signed surface token.",
          description:
            "Use surface=agent for automation clients. The returned accessToken can be sent as Authorization: Bearer <accessToken>.",
          parameters: [
            {
              in: "query",
              name: "surface",
              schema: {
                type: "string",
                enum: ["agent", "host", "remote"],
                default: "remote"
              }
            }
          ],
          responses: {
            200: {
              description: "Signed access token for the requested surface.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BootstrapToken" }
                }
              }
            },
            400: {
              description: "Unsupported surface.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            403: {
              description: "Host bootstrap requested from a non-loopback address without host exposure enabled.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/codex-app-server/live-state": {
        get: securedPath({
          tags: ["read"],
          operationId: "getLiveState",
          summary: "Read the current selected live state.",
          responses: {
            200: {
              description: "Live bridge payload.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LiveState" }
                }
              }
            },
            403: {
              description: "Missing or expired surface token.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/transcript-history": {
        get: securedPath({
          tags: ["read"],
          operationId: "getTranscriptHistory",
          summary: "Load older transcript pages for a thread.",
          parameters: [
            {
              in: "query",
              name: "threadId",
              schema: { type: "string" },
              description: "Defaults to the selected thread when omitted."
            },
            {
              in: "query",
              name: "beforeIndex",
              schema: { type: "string" }
            },
            {
              in: "query",
              name: "limit",
              schema: { type: "string" }
            },
            {
              in: "query",
              name: "visibleCount",
              schema: { type: "string" }
            }
          ],
          responses: {
            200: {
              description: "Transcript history page.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TranscriptHistoryPage" }
                }
              }
            },
            400: {
              description: "Bad history request.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/status": {
        get: securedPath({
          tags: ["read"],
          operationId: "getBridgeStatus",
          summary: "Read operator-facing bridge status and diagnostics.",
          responses: {
            200: {
              description: "Bridge status.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BridgeStatus" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/models": {
        get: securedPath({
          tags: ["read"],
          operationId: "listModels",
          summary: "List available Codex models and supported reasoning efforts.",
          parameters: [
            {
              in: "query",
              name: "includeHidden",
              required: false,
              schema: { type: "boolean" }
            },
            {
              in: "query",
              name: "limit",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 200 }
            }
          ],
          responses: {
            200: {
              description: "Available models and metadata.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ModelListResponse" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/threads": {
        get: securedPath({
          tags: ["read"],
          operationId: "listThreads",
          summary: "Refresh and return the visible thread list.",
          responses: {
            200: {
              description: "Thread list payload.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ThreadsResponse" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/thread": {
        get: securedPath({
          tags: ["read"],
          operationId: "getThreadSnapshot",
          summary: "Read a specific thread snapshot.",
          parameters: [
            {
              in: "query",
              name: "threadId",
              required: true,
              schema: { type: "string" }
            },
            {
              in: "query",
              name: "limit",
              schema: { type: "integer", minimum: 1 }
            }
          ],
          responses: {
            200: {
              description: "Thread snapshot response.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ThreadSnapshotResponse" }
                }
              }
            }
          }
        }),
        post: securedPath({
          tags: ["control"],
          operationId: "createThreadSelection",
          summary: "Create a new Codex thread selection for the provided cwd.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateThreadRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Created thread selection payload.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StateEnvelope" }
                }
              }
            },
            409: {
              description: "Selection conflict.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/latest-thread": {
        get: securedPath({
          tags: ["read"],
          operationId: "getLatestThreadForWorkspace",
          summary: "Return the latest thread for a workspace cwd.",
          parameters: [
            {
              in: "query",
              name: "cwd",
              schema: { type: "string" }
            },
            {
              in: "query",
              name: "limit",
              schema: { type: "integer", minimum: 1 }
            }
          ],
          responses: {
            200: {
              description: "Latest thread snapshot response.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LatestThreadResponse" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/refresh": {
        post: securedPath({
          tags: ["control"],
          operationId: "refreshLiveState",
          summary: "Refresh live state and optionally the thread list.",
          parameters: [
            {
              in: "query",
              name: "threads",
              schema: { type: "string", enum: ["0", "1"] },
              description:
                "Use threads=0 when you only need fresh live state and can reuse the current room list."
            }
          ],
          responses: {
            200: {
              description: "Refreshed live state.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StateEnvelope" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/reconnect": {
        post: securedPath({
          tags: ["control"],
          operationId: "reconnectWatcher",
          summary: "Restart the app-server watcher and refresh live state.",
          parameters: [
            {
              in: "query",
              name: "threads",
              schema: { type: "string", enum: ["0", "1"] }
            }
          ],
          responses: {
            200: {
              description: "Refreshed live state after reconnect.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StateEnvelope" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/selection": {
        post: securedPath({
          tags: ["control"],
          operationId: "setSelection",
          summary: "Switch the selected room and thread.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SelectionRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Selection update payload.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StateEnvelope" }
                }
              }
            },
            409: {
              description: "Selection conflict.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/control": {
        post: securedPath({
          tags: ["control"],
          operationId: "controlRemoteLease",
          summary: "Claim or release remote control for a thread.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ControlRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Updated control state.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StateEnvelope" }
                }
              }
            },
            400: {
              description: "Bad control request.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/interaction": {
        post: securedPath({
          tags: ["control"],
          operationId: "resolveInteraction",
          summary: "Resolve the current pending interaction.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InteractionRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Updated state after interaction resolution.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StateEnvelope" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/interrupt": {
        post: securedPath({
          tags: ["control"],
          operationId: "interruptTurn",
          summary: "Interrupt the selected active turn.",
          responses: {
            200: {
              description: "Interrupt response payload.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/open-in-codex": {
        post: securedPath({
          tags: ["control"],
          operationId: "openInCodex",
          summary: "Reveal the selected thread in the desktop Codex app.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OpenInCodexRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Desktop reveal response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/turn": {
        post: securedPath({
          tags: ["write"],
          operationId: "sendTurn",
          summary: "Send a user turn into the selected or specified thread.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SendTurnRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Accepted turn with the immediate thread snapshot.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SendTurnResponse" }
                }
              }
            },
            409: {
              description: "Turn could not be sent because the thread is busy, control is held elsewhere, or an interaction is pending.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/companion": {
        post: securedPath({
          tags: ["write"],
          operationId: "applyCompanionAction",
          summary: "Summon or resolve a companion wakeup.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CompanionRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Companion action result.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MessageEnvelope" }
                }
              }
            }
          }
        })
      },
      "/api/codex-app-server/agent-room": {
        post: securedPath({
          tags: ["write"],
          operationId: "updateAgentRoom",
          summary: "Operate on the advisory agent room for the selected thread.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AgentRoomRequest" }
              }
            }
          },
          responses: {
            200: {
              description: "Agent-room update result.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MessageEnvelope" }
                }
              }
            }
          }
        })
      },
      "/api/stream": {
        get: securedStreamPath({
          tags: ["stream"],
          operationId: "streamEvents",
          summary: "Open a server-sent event stream with snapshot and live updates.",
          responses: {
            200: {
              description: "SSE stream containing snapshot and live events.",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string"
                  },
                  example:
                    "event: snapshot\ndata: {\"selectedThreadId\":\"thr_example\"}\n\n" +
                    "event: live\ndata: {\"selectedThreadId\":\"thr_example\",\"status\":\"idle\"}\n\n"
                }
              }
            }
          }
        })
      }
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "DextunnelSurfaceToken",
          description: securitySchemesDescription()
        },
        SurfaceTokenHeader: {
          type: "apiKey",
          in: "header",
          name: "x-dextunnel-surface-token",
          description:
            "Compatibility header for older clients. Prefer BearerAuth for new agent integrations."
        },
        SurfaceTokenQuery: {
          type: "apiKey",
          in: "query",
          name: "surfaceToken",
          description:
            "Compatibility query parameter, mainly for SSE or browser EventSource clients that cannot set headers."
        }
      },
      schemas: createOpenApiSchemas()
    }
  };
}

export function buildArazzoDocument({ baseUrl = "" } = {}) {
  return {
    arazzo: "1.0.1",
    info: {
      title: "Dextunnel Bridge Workflows",
      summary: "Common workflows for bootstrapping, reading, and steering Dextunnel threads.",
      version: "2026-03-23"
    },
    sourceDescriptions: [
      {
        name: "dextunnelOpenapi",
        type: "openapi",
        url: joinUrl(baseUrl, OPENAPI_DOC_PATH)
      }
    ],
    workflows: [
      {
        workflowId: "bootstrapAndReadLiveState",
        summary: "Bootstrap an automation token and read the current live state.",
        inputs: {
          type: "object",
          properties: {
            surface: {
              type: "string",
              default: "agent"
            }
          }
        },
        steps: [
          {
            stepId: "bootstrap",
            description: "Issue a signed token for the requested surface.",
            operationId: "bootstrapSurface",
            parameters: [
              {
                name: "surface",
                in: "query",
                value: "$inputs.surface"
              }
            ],
            successCriteria: [{ condition: "$statusCode == 200" }],
            outputs: {
              accessToken: "$response.body.accessToken"
            }
          },
          {
            stepId: "readLiveState",
            description: "Read the current selected live thread and room state.",
            operationId: "getLiveState",
            parameters: [
              {
                name: "x-dextunnel-surface-token",
                in: "header",
                value: "$steps.bootstrap.outputs.accessToken"
              }
            ],
            successCriteria: [{ condition: "$statusCode == 200" }],
            outputs: {
              selectedThreadId: "$response.body.selectedThreadId"
            }
          }
        ],
        outputs: {
          accessToken: "$steps.bootstrap.outputs.accessToken",
          selectedThreadId: "$steps.readLiveState.outputs.selectedThreadId"
        }
      },
      {
        workflowId: "claimControlAndSendTurn",
        summary: "Claim control for the selected thread and send a user turn.",
        inputs: {
          type: "object",
          properties: {
            accessToken: { type: "string" },
            text: { type: "string" },
            threadId: { type: "string" }
          },
          required: ["accessToken", "text"]
        },
        steps: [
          {
            stepId: "claimControl",
            description: "Claim remote control before sending into a live thread.",
            operationId: "controlRemoteLease",
            parameters: [
              {
                name: "x-dextunnel-surface-token",
                in: "header",
                value: "$inputs.accessToken"
              }
            ],
            requestBody: {
              contentType: "application/json",
              payload: {
                action: "claim",
                reason: "agent automation",
                threadId: "$inputs.threadId"
              }
            },
            successCriteria: [{ condition: "$statusCode == 200" }]
          },
          {
            stepId: "sendTurn",
            description: "Send the requested user text into the selected thread.",
            operationId: "sendTurn",
            parameters: [
              {
                name: "x-dextunnel-surface-token",
                in: "header",
                value: "$inputs.accessToken"
              }
            ],
            requestBody: {
              contentType: "application/json",
              payload: {
                text: "$inputs.text",
                threadId: "$inputs.threadId"
              }
            },
            successCriteria: [{ condition: "$statusCode == 200" }],
            outputs: {
              turnId: "$response.body.turn.id"
            }
          }
        ],
        outputs: {
          turnId: "$steps.sendTurn.outputs.turnId"
        }
      },
      {
        workflowId: "watchLiveEvents",
        summary: "Subscribe to the server-sent event stream after bootstrap.",
        inputs: {
          type: "object",
          properties: {
            accessToken: { type: "string" }
          },
          required: ["accessToken"]
        },
        steps: [
          {
            stepId: "openStream",
            description:
              "Open the SSE stream using the compatibility query parameter when a header cannot be set by the client.",
            operationId: "streamEvents",
            parameters: [
              {
                name: "surfaceToken",
                in: "query",
                value: "$inputs.accessToken"
              }
            ],
            successCriteria: [{ condition: "$statusCode == 200" }]
          }
        ]
      }
    ]
  };
}

export function buildLlmsText({ baseUrl = "" } = {}) {
  const links = buildDiscoveryLinks({ baseUrl });
  return [
    "# Dextunnel",
    "",
    "> Local-first bridge API for reading and steering live Codex threads over HTTP JSON and SSE.",
    "",
    "## Start Here",
    "",
    `- Discovery manifest: ${links.manifest}`,
    `- OpenAPI description: ${links.openapi}`,
    `- Arazzo workflows: ${links.arazzo}`,
    `- Agent bootstrap URL: ${bootstrapUrl(baseUrl, "agent")}`,
    "",
    "## Auth",
    "",
    "- Preferred: Authorization: Bearer <accessToken>",
    "- Compatibility: x-dextunnel-surface-token: <accessToken>",
    "- Compatibility for SSE/browser clients: surfaceToken=<accessToken> query parameter",
    "- Bootstrap by calling GET /api/codex-app-server/bootstrap?surface=agent",
    "",
    "## Core Workflow",
    "",
    "1. Fetch the discovery manifest.",
    "2. Bootstrap an agent token.",
    "3. Read /api/codex-app-server/live-state.",
    "4. Claim control with POST /api/codex-app-server/control when needed.",
    "5. Send a turn with POST /api/codex-app-server/turn.",
    "6. Subscribe to GET /api/stream for snapshot and live events.",
    "",
    "## Key Routes",
    "",
    "- GET /api/preflight",
    "- GET /api/codex-app-server/live-state",
    "- GET /api/codex-app-server/transcript-history",
    "- GET /api/codex-app-server/status",
    "- GET /api/codex-app-server/threads",
    "- POST /api/codex-app-server/selection",
    "- POST /api/codex-app-server/control",
    "- POST /api/codex-app-server/interaction",
    "- POST /api/codex-app-server/turn",
    "- GET /api/stream",
    "",
    "## Notes",
    "",
    "- Use surface=agent for automation rather than surface=remote.",
    "- Dextunnel is local-first and optimized for trusted local or tailnet access.",
    "- The desktop Codex app may still require a manual restart to rehydrate externally written turns."
  ].join("\n");
}
