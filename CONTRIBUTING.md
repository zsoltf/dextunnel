# Contributing

Thanks for your interest in Dextunnel.

## Local setup

Prerequisites:

- Node.js
- a local Codex install available via `codex` on `PATH`, `CODEX_BINARY`, or `DEXTUNNEL_CODEX_BINARY`
- Xcode only if you are working on the native Apple surfaces under `native/apple/`

Install and run:

```bash
npm start
```

Open:

- `http://127.0.0.1:4317/`

## Common validation

Run the web and bridge tests:

```bash
npm test
```

Run the native Apple package tests:

```bash
npm run test:native
```

Run the local preflight:

```bash
npm run doctor
```

## Native Apple work

The macOS and iOS seeds live under `native/apple/`.

Useful commands:

```bash
cd native/apple
swift test
xcodegen generate
```

Release/notarization notes live in:

- `docs/ops/apple-menubar-release.md`

## Workflow notes

Some maintainers use local-only workflow state and helper files in their working tree.

Those files are intentionally not part of the public git surface and are not required for normal contributions.

The public source of truth for repo behavior lives in:

- `README.md`
- `docs/index.md`
- `native/apple/README.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `SUPPORT.md`

## Pull requests

- Keep changes scoped and easy to review.
- Add or update tests when behavior changes.
- Prefer small, explicit follow-up docs updates when commands, release flow, or operator behavior changes.
- Use `SUPPORT.md` for general triage expectations and `SECURITY.md` for anything sensitive.
- Follow `CODE_OF_CONDUCT.md` in project spaces.
- Public CI runs from `.github/workflows/ci.yml`; keep local validation aligned with that baseline when possible.
