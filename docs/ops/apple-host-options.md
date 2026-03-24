# Apple Host Options

Date: 2026-03-20
Status: current launch posture

The signed macOS menu bar host is the smoothest local install path when it is available.

Dextunnel supports two local operator shapes on macOS:

## 1. Recommended: menu bar host app

This is the default recommendation for most Mac operators.

Use it when:
- you want the smoothest Mac install path
- you want the clearest local status and recovery controls
- you want Dextunnel to manage the Tailscale publishing step for you
- you want the primary product path we expect most Mac users to take

How:
- install Tailscale on the Mac and sign in
- make sure the Mac is connected in Tailscale
- launch `DextunnelHost`
- let the app start the managed bridge on `127.0.0.1` and publish the remote through `tailscale serve` on the Mac's normal Tailscale HTTPS URL
- open the Tailscale URL shown by the app from your other device on the same tailnet

Why this is the primary recommendation:
- a signed macOS menu bar app target
- local status in the menu bar
- quick reconnect / remote / quit controls
- simple approval handling from the menu
- native notifications for pending actions and failed sends
- a small local control-tower feel
- app-managed bridge startup on a safer Tailscale-backed path

What it is not:
- not a required install
- not a replacement for the remote web client
- not the semantic source of truth

The remote web client remains the compatibility fallback even when the menu bar app is installed.

## 2. Power-user fallback: web remote only

This is the repo-native manual path.

Use it when:
- you want the lowest-friction source-repo workflow
- you want explicit control over how the bridge is started
- you are debugging the bridge itself
- you do not want to use the native host app for this session

How:
- run `npm start`
- open `/` in your browser
- use the same `/` surface from your phone, tablet, or another browser surface

## Managed bridge policy

- The menu bar app only starts the managed bridge when Tailscale is installed on the Mac.
- When Tailscale is ready, the app-managed bridge stays on `127.0.0.1` and Dextunnel publishes the remote through `tailscale serve` on the Mac's normal Tailscale HTTPS URL.
- Dextunnel prefers the clean portless HTTPS URL first and falls back to another HTTPS port if `443` is already taken.
- Release builds bundle the bridge runtime into the app so the signed host does not need a repo checkout or `npm` just to launch.
- If Tailscale is missing or not connected yet, the app should explain that clearly and refuse app-managed startup.
- Manual repo workflows remain available for power users:
  - `npm start` for loopback-only
  - `npm run start:network` for explicit LAN or broad network testing

## Tailscale setup

Keep the instructions simple:

1. Install Tailscale on the Mac.
2. Open Tailscale and sign in.
3. Turn Tailscale on and make sure the Mac shows as connected.
4. Launch `DextunnelHost`.
5. Let Dextunnel handle `tailscale serve` for you.
6. Open the URL shown by Dextunnel Host from another device on the same tailnet.

That is the whole intended happy path. Operators should not need to type Tailscale commands by hand just to use the host app.

If you want the host to show up in Tailscale's Services -> Discovered UI, enable endpoint collection in your tailnet once. That is separate from Dextunnel itself. Dextunnel uses standard `tailscale serve`; true Tailscale Services are a different admin-defined feature.

## Remote Apple client note

- The menu bar host app now keeps its managed bridge local at `http://127.0.0.1:4317` and publishes the operator remote through the Mac's Tailscale HTTPS URL.
- Manual loopback still works if you start the bridge yourself and connect the app or browser to `http://127.0.0.1:4317`.
- The universal iOS operator app should use the Mac's LAN or Tailscale address instead.
- When you want iPhone or iPad access, start the bridge with:

```bash
npm run start:network
```

- Then connect the iOS app to:
  - `http://<your-mac-lan-ip>:4317`
  - or `http://<your-tailscale-ip>:4317`

## Launch stance

Before launch, treat the menu bar host as the primary recommended Mac path.
Treat the remote web client as the universal compatibility fallback and the manual power-user path.

That means:
- steer Mac users toward the host app first
- keep the remote web path visible as fallback, not as the main recommendation
- keep product copy clear that the menu bar host is the preferred path on Mac
- keep the app-managed startup path honest about its Tailscale requirement
