# Apple Host Options

Date: 2026-03-20
Status: current launch posture

The signed macOS menu bar host is the smoothest local install path when it is available.

Dextunnel supports two local operator shapes on macOS:

## 1. Web remote only

This is the simplest path and the repo-native manual fallback.

Use it when:
- you do not want a native macOS host shell
- you want the lowest-friction manual repo path
- you prefer the shared web remote for observability and replies
- you do not want the app-managed Tailscale policy

How:
- run `npm start`
- open `/remote.html` in your browser
- use the same `/remote.html` surface from your phone, tablet, or another browser surface

## 2. Optional menu bar host app

This is the thin native shell for people who want:
- a signed macOS menu bar app target
- local status in the menu bar
- quick reveal / refresh affordances
- simple approval handling from the menu
- native notifications for pending actions and failed sends
- a small local control-tower feel
- app-managed bridge startup on a safer Tailscale-backed path

What it is not:
- not a required install
- not a replacement for the remote web client
- not the semantic source of truth

The remote web client remains the compatibility fallback even when the menu bar app is installed.

## Managed bridge policy

- The menu bar app only starts the managed bridge when Tailscale is installed on the Mac.
- When Tailscale is ready, the app-managed bridge binds to the Mac's Tailscale address instead of `0.0.0.0`.
- Release builds bundle the bridge runtime into the app so the signed host does not need a repo checkout or `npm` just to launch.
- If Tailscale is missing or not connected yet, the app should explain that clearly and refuse app-managed startup.
- Manual repo workflows remain available for power users:
  - `npm start` for loopback-only
  - `npm run start:network` for explicit LAN or broad network testing

## Remote Apple client note

- The menu bar host app now prefers the Mac's Tailscale bridge address when it can manage the bridge itself.
- Manual loopback still works if you start the bridge yourself and connect the app to `http://127.0.0.1:4317`.
- The universal iOS operator app should use the Mac's LAN or Tailscale address instead.
- When you want iPhone or iPad access, start the bridge with:

```bash
npm run start:network
```

- Then connect the iOS app to:
  - `http://<your-mac-lan-ip>:4317`
  - or `http://<your-tailscale-ip>:4317`

## Launch stance

Before launch, treat the menu bar host as the smoothest signed-install path for Mac operators.
Treat the remote web client as the universal compatibility fallback.

That means:
- do not hide the remote web path
- do not force native install for core operation
- keep product copy clear that the menu bar host is additive, not mandatory
- keep the app-managed startup path honest about its Tailscale requirement
