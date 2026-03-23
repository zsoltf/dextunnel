# Apple Menu Bar Release

Date: 2026-03-22
Status: current release path

This is the repo-native path for producing a signed, self-contained `DextunnelMenuBarHostApp` build.

## What the release build includes

- the Swift menu bar host app
- an embedded Dextunnel bridge runtime under `EmbeddedBridge/`
- an embedded Node runtime copied from the build machine, including its supporting dylibs
- the current `src/`, `public/`, and `package.json` bridge assets

That means the release app no longer needs the repo checkout, Homebrew Node, or `npm` just to start the managed bridge.

## Prerequisites

- Xcode with a valid Developer ID signing identity for your Apple team
- Tailscale installed on the target Mac
- Node available on the build machine so the bridge runtime can be embedded
- notarization credentials stored in Keychain for `notarytool`

## Required environment

- `DEXTUNNEL_APPLE_TEAM_ID`
- `DEXTUNNEL_APPLE_NOTARY_PROFILE`

Optional overrides:

- `DEXTUNNEL_APPLE_SIGNING_IDENTITY`
- `DEXTUNNEL_NODE_BINARY`
- `DEXTUNNEL_APPLE_DIST_ROOT`
- `DEXTUNNEL_APPLE_CONFIGURATION`

## Build phases

The macOS target now runs `native/apple/scripts/prepare-embedded-bridge.sh` before each build.

That script stages a bundle-local runtime into:

- `native/apple/.build-resources/EmbeddedBridge`

The staged runtime is then copied into the app bundle as a normal resource.
During export, `native/apple/scripts/release-menubar-host.sh` re-signs the embedded Node runtime and dylibs before re-signing the `.app` for notarization.

## Release commands

Archive only:

```bash
npm run native:host:archive
```

Archive plus export:

```bash
npm run native:host:export
```

Notarize an already exported app:

```bash
npm run native:host:notarize
```

Full release flow:

```bash
npm run native:host:release
```

Artifacts land in:

- `native/apple/dist/<timestamp>/`

The notarized output is a stapled `.app` plus a zipped copy ready to distribute.

## Notes

- The menu bar app still refuses app-managed bridge startup when Tailscale is missing or not connected yet.
- If `DEXTUNNEL_APPLE_TEAM_ID` or `DEXTUNNEL_APPLE_NOTARY_PROFILE` are missing, the release script now fails immediately with the exact missing variable name.
- Manual repo workflows remain valid for power users:
  - `npm start`
  - `npm run start:network`
