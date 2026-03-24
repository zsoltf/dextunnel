# npm Publish

Date: 2026-03-23
Status: advanced CLI release path

This is the advanced public release story for the Dextunnel CLI.

- publish the CLI bridge to npm as `dextunnel`
- ship the macOS menu bar host as a direct notarized zip download

The primary supported path for most operators is still the signed Mac host plus Tailscale.
The npm package is for advanced manual use, local automation, and people who explicitly want the bridge outside the host app.

## Important: npm does not need a separate repo

The npm package is published from this same source repository.

You do **not** need:

- a second GitHub repo
- a tap repo
- a special npm-only mirror

You **do** need:

- an npm account
- publish permission for the package name you want
- this repo in a releasable state

## Package naming

Right now [package.json](../../package.json) uses:

```json
{
  "name": "dextunnel"
}
```

That means the intended public install is:

```bash
npm install -g dextunnel
```

Before first publish, confirm the name is still available:

```bash
npm view dextunnel version
```

If that returns a real version, the unscoped name is already taken and you need to choose a different package name or move to a scope such as `@yourname/dextunnel`.

## Unscoped vs scoped

Current repo state is unscoped:

- package name: `dextunnel`
- install command: `npm install -g dextunnel`
- unscoped packages are public

If you later switch to a scoped package, example `@yourname/dextunnel`, the first publish of a public package should be:

```bash
npm publish --access public
```

## What gets published

The npm package is intentionally small and only includes the runtime files declared in [package.json](../../package.json):

- `src/`
- `public/`
- `LICENSE`
- `README.md`
- `SECURITY.md`
- `SUPPORT.md`

The installable CLI command is:

- `dextunnel`

It is wired through:

- [src/bin/dextunnel.mjs](../../src/bin/dextunnel.mjs)

## Pre-publish checklist

1. Make sure you are logged into the correct npm account:

```bash
npm whoami
```

2. If you are not logged in:

```bash
npm login
```

3. Confirm the package contents look right:

```bash
npm pack --json --dry-run --ignore-scripts
```

4. Run the release check:

```bash
npm run release:check
```

5. Smoke-check the CLI locally:

```bash
node src/bin/dextunnel.mjs --help
node src/bin/dextunnel.mjs --version
node src/bin/dextunnel.mjs doctor
```

6. Bump the version in [package.json](../../package.json).

## Recommended release order

If you want to validate privately before opening the repo and talking about it publicly, the clean order is:

1. Push the current branch to a private remote first.
2. Run `npm run release:check`.
3. Run `npm pack --json --dry-run --ignore-scripts` and confirm the tarball contents look right.
4. Build the Mac host artifact:

```bash
npm run native:host:export
```

5. If you are doing the signed public Mac build, notarize it:

```bash
npm run native:host:notarize
```

6. Do the manual launch pass on the exact repo fingerprint you plan to ship:

```bash
npm run launch:attest-manual
npm run launch:status
```

7. Publish the CLI to npm.
8. Make the GitHub repo public only after the package and host artifact look correct.
9. Start marketing after the public repo, npm package, and host download all point at the same product story.

## First publish

For the current unscoped package name:

```bash
npm publish
```

If npm asks for a one-time password, enter the code from your authenticator.

## Post-publish verification

1. Confirm the registry sees the package:

```bash
npm view dextunnel version
```

2. Install it fresh on a clean machine or in a disposable environment:

```bash
npm install -g dextunnel
```

3. Verify the installed CLI:

```bash
dextunnel --help
dextunnel --version
```

4. Start the bridge:

```bash
dextunnel serve
```

## If the name is taken

If `dextunnel` is no longer available, there are two clean options:

1. Pick a different unscoped public name.
   Example:
   - `dextunnel-cli`

2. Publish under your npm scope.
   Example:
   - `@yourname/dextunnel`

If you choose the scoped route, remember the first public publish should include:

```bash
npm publish --access public
```

## Official npm docs

- [Creating and publishing unscoped public packages](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- [Package name guidelines](https://docs.npmjs.com/package-name-guidelines/)
- [About scopes](https://docs.npmjs.com/about-scopes)
- [npm access](https://docs.npmjs.com/cli/v11/commands/npm-access/)
