# Dextunnel

Transcript-first mobile companion for Codex.

Monitor runs, reply to threads, and handle approvals from your phone without remote desktop pain.

Think VibeTunnel for Codex, but built around transcript flow, thread write-back, and approvals instead of just terminal remoting.

Current status: local-first web beta track for people already running real Codex sessions.

## Quickstart

Prerequisite: Dextunnel needs a local Codex install it can launch. By default it will try:

- `DEXTUNNEL_CODEX_BINARY`
- `CODEX_BINARY`
- the bundled macOS Codex app binary
- `codex` on `PATH`

Start the bridge:

```bash
npm start
```

Then open [http://127.0.0.1:4317/](http://127.0.0.1:4317/).

The landing page now runs a local preflight and tells you:

- whether Dextunnel can find the Codex binary
- whether Codex `app-server` is healthy
- whether this repo already has a visible Codex thread
- what to do next before opening `/remote.html`

CLI preflight:

```bash
npm run doctor
```

If the preflight says this workspace has no visible thread yet, open Codex in this repo once, then refresh and open the remote.

Alternative Mac host path:

- build and run the `DextunnelMenuBarHostApp` target from `native/apple/`
- the menu bar app now prefers a Tailscale-backed managed bridge when Tailscale is installed on the Mac
- if Tailscale is missing, the app should refuse app-managed startup and point you back to the manual `npm` path instead
- release builds now bundle the bridge runtime plus the Node runtime it needs into the app, so the signed host app can start its own managed bridge without a repo checkout or Homebrew Node
- the signed distribution flow lives in [docs/ops/apple-menubar-release.md](docs/ops/apple-menubar-release.md)

For phone or tablet access on LAN or Tailscale:

```bash
npm run start:network
```

## Why This Exists

- Long Codex runs do not stop mattering when you step away from your desk.
- SSH, browser terminals, and remote desktop are all painful on a phone for transcript-heavy workflows.
- Dextunnel turns real Codex threads into a mobile-friendly control surface for monitoring, replies, and approvals.

## What Is Real Today

- Real Codex thread browsing through `app-server`
- Real live write-back into selected Codex threads
- Real structured approvals and user-input handling
- Mobile-friendly transcript view for active sessions
- Multi-surface control handoff between desktop and remote surfaces
- Shared-room semantics with surface-local drafts, queue, filters, and scroll state

## What This Is Not

- Not a generic remote desktop tool
- Not just a browser terminal
- Not a hosted relay SaaS
- Not pretending the rough edges are solved yet

## Prototype Shape

This repo is an MVP for a two-layer product:

- A generic host-side remote substrate for window targeting, remote control, and resize profiles
- A Codex-shaped companion UI that prefers semantic transcript/control when available and falls back gracefully when it is not

The current prototype is intentionally honest:

- It is local-only
- It uses Server-Sent Events plus HTTP instead of WebRTC
- It now watches a selected real Codex thread through `app-server`
- It now includes a working live composer write path through `app-server`
- It now surfaces live approvals and tool input requests through the companion UI
- It demonstrates the safer session browser, shared live state, and mobile-first companion UX

## Why Not Just SSH, VNC, Or A Browser Terminal?

### Why not just SSH, Termius, or a browser terminal?

Those tools give you transport.
Dextunnel gives you the Codex interaction surface you actually need on mobile: transcript, thread context, approvals, replies, and clearer control semantics.

### Why not just VNC or remote desktop?

Remote desktop streams pixels.
Dextunnel is built around the actual workflow problem: reading what Codex is doing, responding when it needs input, and keeping the session moving from a phone.

### Is this just VibeTunnel for Codex?

That is the fastest way to understand the category, but it is not the whole story.
Dextunnel is built around Codex threads, transcript flow, write-back, and approvals, not just terminal access.

### Why not wait for official mobile support?

Because people are already running long-lived Codex sessions now.
Dextunnel is for the workflow that already exists today: local-first, power-user, and mobile-interrupted.

## What Is Included

- Mobile-friendly remote companion at `/remote.html`
- Native Apple seed under `native/apple/`
- Local macOS menu bar host is the smoother signed-app path on Mac when Tailscale is installed; the main universal fallback remains the remote companion
- Cross-project and cross-session selection shared by host and remote
- Shared live-state watcher with SSE fanout from the local Node bridge
- Real Codex transcript rendering with filterable `Thread` and `Updates` lanes
- Remote composer path that uses `app-server` live write-back on the selected thread
- Live approval and user-input action panels for the selected thread
- Flat terminal-style host and remote UI with lightweight ticker and card animation
- Mock adapter controls kept only in the host debug lane
- Node test coverage for the session store
- Swift package coverage plus real Apple app targets for:
  - macOS menu bar host shell
  - universal iOS operator app
  - native speech-to-draft dictation inside the iOS operator shell

## What Is Not Included Yet

- A guaranteed stock desktop UI refresh when an external companion writes into the same thread
- A strong control lock or first-send confirmation for two-writer safety
- Real Accessibility or CGEvent input injection
- Real ScreenCaptureKit video capture
- Real WebRTC transport
- Real-device native proof over Tailscale or LAN

## Web Launch Scope

The current launch track is the local web remote.

- The remote acts on the selected live Codex thread.
- Host and remote intentionally share that room and thread selection.
- Drafts, queue, filters, and scroll stay local to each surface.
- Dextunnel shows remote writes immediately, but the stock desktop Codex app may still need a quit and reopen to catch up.
- Native Apple surfaces remain optional seed work, not part of the current web beta bar.

## FAQ

### What problem does Dextunnel solve?

It lets you keep a real Codex session moving after you leave your desk.
You can monitor the selected live thread, answer follow-up prompts, and handle approvals from another device without using a tiny remote desktop or terminal.

### Does Dextunnel talk to real Codex threads?

Yes. The current prototype already supports real thread browsing and real write-back through Codex `app-server`.

### Does the desktop Codex app update instantly after a remote write?

Not reliably. Dextunnel writes into the real persisted Codex session store, and Dextunnel itself reads those turns back immediately, but the stock desktop app may lag on those out-of-band writes. Today the only confirmed way to make desktop show those new messages is a full app restart.

The UI now treats that as an explicit product contract:
- `Reveal in Codex` navigates the desktop app to the selected thread
- manual desktop recovery means quitting and reopening Codex yourself when you need desktop to rehydrate newly written turns

### Is Dextunnel local-first?

Yes. The current product direction is local-first, not a mandatory hosted relay.

### Is Dextunnel a general remote desktop product?

No. The center of the product is Codex-native transcript and control flow. Pixel streaming is fallback territory, not the main story.

### Is Dextunnel production-ready?

Not yet. This should be presented as a sharp beta for early adopters who already run Codex sessions and want a local web remote for visibility and intervention.

### What is the biggest advantage over SSH or VNC?

Legibility and workflow fit.
The phone UI is built around transcript, approvals, and replies instead of pretending a remote terminal or desktop is a good mobile experience.

## Community And Support

- Usage questions and bug reports: see [SUPPORT.md](SUPPORT.md)
- Sensitive security reports: see [SECURITY.md](SECURITY.md)
- Community expectations: see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Contributor setup and validation: see [CONTRIBUTING.md](CONTRIBUTING.md)
- CI for the public repo lives under `.github/workflows/ci.yml`

## License

Dextunnel is licensed under [Apache-2.0](LICENSE).

## Run It

```bash
npm start
```

Then open:

- [http://localhost:4317/](http://localhost:4317/) for the setup page and preflight
- [http://localhost:4317/remote.html](http://localhost:4317/remote.html)
- [http://localhost:4317/host.html](http://localhost:4317/host.html) if you want the legacy local host entry point; it now redirects to the remote web client

Native Apple seed:

```bash
cd native/apple
xcodegen generate
swift test
xcodebuild -project DextunnelAppleApps.xcodeproj -scheme DextunnelMenuBarHostApp -configuration Debug -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project DextunnelAppleApps.xcodeproj -scheme DextunnelUniversalIOSOperatorApp -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Host options on macOS:

- Web remote only:
  - run `npm start`
  - use [http://localhost:4317/remote.html](http://localhost:4317/remote.html)
- Optional menu bar host app:
  - build and launch `DextunnelMenuBarHostApp`
  - use it as a thin local control tower for status and quick recovery
  - the app-managed bridge path now requires Tailscale on the Mac and prefers the Mac's Tailscale address
  - release builds now embed the bridge runtime, so the app can launch without `npm`
  - manual `npm` startup remains the fallback for power users

Install and rollout note: [docs/ops/apple-host-options.md](/Users/zsolt/dev/codex/dextunnel/docs/ops/apple-host-options.md)
Apple menu bar release flow: [docs/ops/apple-menubar-release.md](/Users/zsolt/dev/codex/dextunnel/docs/ops/apple-menubar-release.md)

## Test It

```bash
npm run doctor
npm test
npm run test:native
```

## Probe The Real Codex Session Model

The bridge uses Codex's experimental `app-server` subcommand over a local websocket.

CLI probe:

```bash
npm run probe:app-server
npm run probe:app-server-write
```

HTTP probe while the local server is running:

```bash
curl http://localhost:4317/api/codex-app-server/status
curl http://localhost:4317/api/codex-app-server/threads
curl http://localhost:4317/api/codex-app-server/live-state
curl http://localhost:4317/api/codex-app-server/latest-thread
```

The read path is proven in the MVP, and live write now works against selected real threads through the same watched app-server session. The main remaining caution is product-level rather than protocol-level: the companion is acting like a second rich client, so the remote feed sees those writes immediately while the stock desktop UI may lag before it notices the updated local session state.

Desktop sync note: [docs/ops/desktop-sync.md](/Users/zsolt/dev/codex/dextunnel/docs/ops/desktop-sync.md)

## Repo Guide

- Native Apple seed: [native/apple/README.md](/Users/zsolt/dev/codex/dextunnel/native/apple/README.md)
- Docs map: [docs/index.md](/Users/zsolt/dev/codex/dextunnel/docs/index.md)
- Contributing: [CONTRIBUTING.md](/Users/zsolt/dev/codex/dextunnel/CONTRIBUTING.md)
