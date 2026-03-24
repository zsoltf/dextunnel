# Dextunnel Apple Surface Seed

Date: 2026-03-20
Status: seed with working app shells

This folder is the first bounded native seed for V2-07 and the starting point for V2-08.

It is intentionally still thin:

- no duplicate daemon logic
- no attempt to outrun the current web/Tailscale proof
- no claim that native is launch-blocking ahead of the web operator shell

## Purpose

Give future Apple surfaces a stable contract and a clean rollout story.

The daemon remains the semantic source of truth.
Apple clients should own:

- local UX
- local persistence for drafts and view state
- Apple system affordances

The daemon should continue owning:

- Codex app-server bridge
- room, participant, and lease semantics
- transcript normalization
- advisory room orchestration

## Seed modules

### `DextunnelBridgeProtocol`

Shared bridge-facing models for:

- surface bootstrap
- live payload snapshots
- operator diagnostics
- selected channel metadata
- attachment summaries

This target should stay small and Codable-first.

### `DextunnelBridgeClient`

Thin native client helpers for:

- bootstrap-backed request building
- bridge route access
- basic response decoding
- SSE/event parsing groundwork

This target should stay daemon-facing and transport-focused.

### `DextunnelOperatorCore`

Shared native operator logic for:

- queue / steer gating
- compact status copy
- menu bar summary shaping
- desktop sync truth

This target should stay UI-framework-agnostic so iPhone, iPad, and macOS shells can all share it.

### `DextunnelSurfaceContracts`

Apple rollout boundaries and per-surface capability contracts.

This target exists so native expansion stays intentional instead of sprawling.

### `DextunnelAppleState`

Shared native live-room state for:

- bridge bootstrap
- live payload refresh and streaming
- room-scoped draft persistence
- queue / steer flows
- control claim and release
- pending interaction handling
- reveal and diagnostics state

### `DextunnelNativeAppSupport`

Thin bootstrap controller for native apps:

- bridge base URL persistence
- fresh signed bootstrap fetch
- live store creation
- connect / disconnect flow
- local notification coordination for high-signal operator events

### `DextunnelMenuBarHostShell`

SwiftUI menu bar host surface for:

- room summary
- diagnostics
- pending action summary
- simple approval actions
- recent activity preview
- local notifications for pending actions and failed sends while the app is in the background
- browser-open affordances
- remote control actions from the menu

### `DextunnelUniversalIOSShell`

SwiftUI universal operator surface for:

- compact iPhone layout
- regular-width iPad layout
- transcript rendering
- turn-diff changes rendering
- room list and selection
- queue / steer / approvals
- native speech-to-draft dictation
- reconnect-safe outbox receipts
- reveal and desktop sync truth

## App targets

`project.yml` now defines two real app targets:

- `DextunnelMenuBarHostApp` (produces `DextunnelHost.app`)
- `DextunnelUniversalIOSOperatorApp`

Shared setup UI lives in:

- `Apps/Shared/BridgeSetupView.swift`

The app shells are intentionally simple:

- menu bar host bootstraps from a bridge base URL and exposes status plus browser-open affordances
- menu bar host is now aimed at a signed macOS menu bar app flow
- menu bar host is the primary recommended Mac path; manual npm startup remains the power-user fallback
- menu bar host now keeps the managed bridge on `127.0.0.1` and publishes the remote through `tailscale serve` on the Mac's normal Tailscale HTTPS URL when Tailscale is installed and connected
- menu bar host release builds now bundle the bridge runtime plus the Node dylibs it depends on into the app itself
- menu bar host only starts the app-managed bridge when Tailscale is present, so the native happy path stays opinionated instead of silently exposing a broad listener
- menu bar host still allows manual repo workflows as the fallback path:
  - connect to `http://127.0.0.1:4317` after `npm start`
  - or use `npm run start:network` intentionally for explicit LAN or broader network testing
- menu bar host now also exposes pending-action summary and recent transcript-derived activity in the menu itself
- menu bar host now handles simple approval decisions directly from the menu without pretending to be a full transcript client
- universal iOS app bootstraps from a bridge base URL and renders the native operator shell, including:
  - first launch now starts blank on purpose instead of implying `127.0.0.1` is a valid mobile operator address
  - setup copy points operators at the Mac's LAN or Tailscale address plus `npm run start:network`
  - native speech dictation into the draft composer
  - transcript rendering from live bridge payloads
  - turn-diff changes rendering from live bridge payloads
  - room-scoped draft and queue recovery
  - queue delivery status that stays explicit across reconnects:
    - `Queued locally`
    - `Sending`
    - `Send failed`
    - short `Recent sent` receipts that distinguish:
      - `Accepted by bridge`
      - `Seen in room`
  - bounded local notifications for:
    - pending interactions that need attention
    - failed queued sends that need a retry

## Verified state

The current seed is no longer just architecture-only.

Verified locally:

- `cd native/apple && swift test`
- `npm run test:native`
- `npm run smoke:native-bridge -- --base-url http://127.0.0.1:4317`
- `cd native/apple && xcodegen generate`
- `cd native/apple && xcodebuild -project DextunnelAppleApps.xcodeproj -scheme DextunnelMenuBarHostApp -configuration Debug -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build`
- `cd native/apple && xcodebuild -project DextunnelAppleApps.xcodeproj -scheme DextunnelUniversalIOSOperatorApp -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`

That means:

- the shared package targets compile and test
- the macOS menu bar app target builds
- the universal iOS app target builds for simulator
- the current native shells go beyond setup-only scaffolding:
  - the menu bar app behaves like a small local control tower
  - the iOS app can read transcript and changes, not just send actions
  - the shared native bridge client can decode the current live `/live-state` and `/threads` payloads for both host and remote surfaces
  - the iOS app can restore room-scoped draft and queue state across reconnects
  - interrupted queued sends now restore as explicit `failed` items instead of disappearing
  - interrupted `Steer now` sends now restore as explicit retryable outbox items too, instead of vanishing if the app dies mid-send
  - room switching is guarded while a send is in flight
  - accepted mobile sends now reconcile forward to `Seen in room` once the live transcript proves them

What is not yet proven:

- real-device iPhone proof
- real-device iPad proof
- networked Tailscale operator proof through the native client
- launch-quality polish beyond the bounded operator scope

## Rollout order

1. `macOS menu bar host shell`
   - lifecycle
   - browser-open affordances
   - notifications
   - trust bootstrap
   - local status / overview

2. `universal iOS operator`
   - one app
   - iPhone compact operator layout
   - iPad regular-width operator layout
   - queue
   - steer
   - approvals
   - dictation
   - quick room selection

3. `watch companion`
   - approve
   - quick dictate
   - short canned actions

## Success criteria

### macOS menu bar host shell

- can bootstrap and reveal the managed bridge cleanly
- can refuse app-managed startup honestly when Tailscale is missing or not ready
- can explain restart-to-rehydrate truth honestly
- can surface pending-action and recent-activity context at a glance
- can surface local notifications and local status without owning semantic truth

### universal iOS operator

- queue and steer feel better than the web shell on the move
- reconnect and draft recovery stay calm
- queued intent and draft text stay scoped to the active room
- queued drafts can be pruned locally instead of getting stuck behind stale intent
- accepted sends reconcile forward to transcript-confirmed receipts instead of stopping at local dequeue
- dictation feels native and bounded
- iPhone compact layout stays fast and one-handed
- iPad regular-width layout makes transcript plus changes materially better than web, not just different
- transcript and changes stay faithful to the daemon payload instead of inventing native-only semantics

### watch companion

- bounded and high-signal only
- never a primary full-control surface

## Current guardrail

Do not treat this seed as permission to widen native scope before:

- V2-06 networked operator proof is honestly written down
- bridge truth and lease authority stay stable
- desktop rehydration behavior remains explicit in product copy

## Browser-host option

The browser host remains a first-class supported path.

People who do not want the menu bar host app can still:

- run `npm start`
- use `/host.html` as the host surface
- use `/` or the `/remote.html` compatibility alias, or use the universal iOS app as the operator surface

The menu bar host is additive convenience, not a required install.

## Address truth

- the app-managed macOS menu bar host now keeps the bridge on `127.0.0.1` and exposes the operator remote through the Mac's normal Tailscale HTTPS URL.
- `127.0.0.1` remains the manual fallback when you start the bridge yourself with `npm start`.
- iPhone and iPad clients should use the Mac's LAN or Tailscale address instead.
- For remote Apple surfaces, start the bridge with:

```bash
npm run start:network
```

- Then connect the native app to:
  - `http://<your-mac-lan-ip>:4317`
  - or `http://<your-tailscale-ip>:4317`
