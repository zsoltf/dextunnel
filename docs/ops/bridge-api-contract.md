# Bridge API Contract

Date: 2026-03-19
Status: advanced local integration contract

## Purpose

This document describes the current local bridge surface that host and remote clients talk to.

It is not a public cloud API.
It is the contract the current browser surfaces depend on, and the contract future native clients should preserve unless a versioned replacement exists.
It is an advanced integration surface for local automation and power users, not the primary first-use path most people should start with.

## Transport

- HTTP JSON for request/response routes
- SSE on `/api/stream` for live updates

## Discovery

- `GET /.well-known/dextunnel.json`
- `GET /openapi.json`
- `GET /arazzo.json`
- `GET /llms.txt`

These discovery endpoints are intentionally unauthenticated so an agent that only knows the base URL can find the bootstrap route, the HTTP schema, the common workflows, and the lightweight LLM-oriented summary.

## Authority model

- Surface authority comes from a signed bootstrap token injected into `/` for the remote surface, the `/remote.html` compatibility alias, or `/host.html`.
- The token is accepted through:
  - `Authorization: Bearer <token>` for standard agent and script clients
  - `x-dextunnel-surface-token` on `fetch`
  - `surfaceToken` query param on URL-based paths; today that is mainly used for SSE and `sendBeacon`-style flows, but the runtime accepts it anywhere `searchParams` are available
- Each token also carries a server-issued surface `clientId`.
- Mutating routes derive actor identity from that signed `clientId`, not from request-body labels.
- The `/host.html` bootstrap page stays loopback-only unless `DEXTUNNEL_EXPOSE_HOST_SURFACE=1` is explicitly enabled.
- Callers still choose target parameters such as `threadId` and `cwd`; identity comes from the signed token, targeting comes from the request.

## Core payloads

### Install preflight

Returned by:
- `GET /api/preflight`

Important fields:
- `status`
- `summary`
- `checks`
- `nextSteps`
- `codexBinary`
- `appServer`
- `workspace`

Note:
- this route is intentionally unauthenticated so the setup page at `/` can render first-run health before a surface bootstrap exists

### Live payload

Returned by:
- `GET /api/codex-app-server/live-state`
- most mutating routes as `state`
- SSE `live` events on `/api/stream`

Important fields:
- `selectedProjectCwd`
- `selectedThreadId`
- `selectedThreadSnapshot`
- `selectedChannel`
- `selectedAttachments`
- `participants`
- `selectedCompanion`
- `turnDiff`
- `threads`
- `pendingInteraction`
- `selectedAgentRoom`
- `status`

Note:
- this is a practical high-signal subset, not a full JSON schema dump

### Bridge status

Returned by:
- `GET /api/codex-app-server/status`

Important fields:
- `watcherConnected`
- `lastWrite`
- `lastInteraction`
- `lastSelectionEvent`
- `lastSurfaceEvent`
- `lastControlEvent`
- `diagnostics`

Diagnostics note:
- `status.diagnostics` is a compact machine-readable list for operator-proof runs and future native clients.
- Current codes include:
  - `bridge_unavailable`
  - `no_selected_room`
  - `host_unavailable`
  - `control_held`
  - `desktop_restart_required`
  - `bridge_last_error`

## Main route groups

### Read / observe

- `GET /api/preflight`
- `GET /api/state`
- `GET /api/codex-app-server/live-state`
- `GET /api/codex-app-server/status`
- `GET /api/codex-app-server/changes`
- `GET /api/codex-app-server/threads`
- `GET /api/codex-app-server/thread`
- `GET /api/codex-app-server/latest-thread`
- `GET /api/stream`

### Room / thread control

- `POST /api/codex-app-server/selection`
- `POST /api/codex-app-server/thread`
- `POST /api/codex-app-server/refresh`
- `POST /api/codex-app-server/open-in-codex`

Transport note:
- `POST /api/codex-app-server/refresh?threads=0`
  - lightweight refresh path for clients that only need fresh live state and can reuse the current room list

### Presence / lease / interaction

- `POST /api/codex-app-server/presence`
- `POST /api/codex-app-server/control`
- `POST /api/codex-app-server/interaction`
- `POST /api/codex-app-server/interrupt`

### Send / companion

- `POST /api/codex-app-server/turn`
- `POST /api/codex-app-server/companion`
- `POST /api/codex-app-server/agent-room`

### Dev-only

Only when `DEXTUNNEL_PROFILE=dev`:
- `POST /api/debug/live-interaction`
- `POST /api/debug/companion-wakeup`
- `POST /api/commands`

Runtime note:
- the profile gate is expressed in code through `devToolsEnabled`

## Surface capabilities

### Remote

- read room
- select room
- sync presence
- refresh room
- reveal thread in Codex
- respond to pending interactions
- claim and use remote control
- release its own remote lease
- interrupt the selected live turn
- send turns
- use companion wakeups
- use the advisory council room

### Agent

- read room
- select room
- refresh room
- respond to pending interactions
- claim and use remote control
- send turns

Notes:
- `agent` is the preferred bootstrap surface for automation and machine clients
- it intentionally excludes UI-only features such as companion wakeups, agent-room controls, and surface-presence sync

### Host

- read room
- select room
- sync presence
- refresh room
- reveal thread in Codex
- respond to pending interactions
- release a remote lease
- dev-only debug tools

## Current product truths

- Dextunnel writes to the real persisted Codex session store.
- Desktop Codex may require a full restart to rehydrate externally written turns.
- `Reveal in Codex` is a convenience navigation path, not a guaranteed desktop visibility or rehydrate hook.
- Desktop recovery is manual: quit and reopen the Codex app when you need to see newer turns there.

## Compatibility rule

Future clients should treat:
- live payload shape
- surface-token authority
- room/control/interaction semantics

as the stable contract unless a versioned replacement is introduced.

Current efficiency rule:
- clients should prefer the lightweight refresh path when they do not actually need a new room-list snapshot
- full `/threads` refresh should be reserved for room-list-visible changes, not used as a default follow-up to every action
