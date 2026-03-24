# Dextunnel

It's like VibeTunnel, but for the Codex app.

Dextunnel lets you keep a real Codex session moving from your phone. Read the thread, reply, queue messages, and clear approvals without doing SSH or remote desktop on a tiny screen.

Recommended on Mac: `DextunnelHost` + Tailscale.
If you want the advanced manual path, use `npm start`.
Native iPhone and iPad app coming soon.

## Mac

This is the main path.

1. Install Tailscale on the Mac.
2. Open Tailscale, sign in, and turn it on.
3. Launch `DextunnelHost`.
4. Open the Tailscale URL the app shows.

That's it.

`DextunnelHost` keeps the bridge on `127.0.0.1` and handles `tailscale serve` for you.

Why Tailscale:

- it has a free personal tier
- it keeps the Mac setup dead simple
- it keeps the bridge local-first
- no weird port-forwarding nonsense

Setup links:

- Tailscale download: [tailscale.com/download](https://tailscale.com/download)
- Tailscale getting started: [tailscale.com/kb/1017/install](https://tailscale.com/kb/1017/install)
- Mac host notes: [docs/ops/apple-host-options.md](docs/ops/apple-host-options.md)

## Advanced Manual Path

If you want full manual control:

```bash
npm start
npm run doctor
```

Then open [http://127.0.0.1:4317/](http://127.0.0.1:4317/).

Use `npm run start:network` only if you intentionally want a manual LAN or broader-network listener.

## Today

- browse real Codex threads through `app-server`
- reply and queue from the remote
- approvals and user input
- shared room and thread selection between the Mac host and the remote

## Rough Edges

- desktop Codex visibility is not live yet; quit and reopen Codex when you need it to rehydrate remote-written turns
- this is still beta software
- this is for a trusted local machine plus your own devices, not a public multi-user service

## Dev

App name: `DextunnelHost.app`

```bash
cd native/apple
xcodegen generate
swift test
xcodebuild -project DextunnelAppleApps.xcodeproj -scheme DextunnelMenuBarHostApp -configuration Debug -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build
```

## Validate

```bash
npm run doctor
npm run release:check
```

`release:check` runs the Node suite, the native Swift suite, and refreshes the automated launch attestation.

## Docs

- Mac host release: [docs/ops/apple-menubar-release.md](docs/ops/apple-menubar-release.md)
- npm publish: [docs/ops/npm-publish.md](docs/ops/npm-publish.md)
- Native Apple seed: [native/apple/README.md](native/apple/README.md)
- Docs map: [docs/index.md](docs/index.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)
- Support: [SUPPORT.md](SUPPORT.md)

## License

Dextunnel is licensed under [Apache-2.0](LICENSE).
