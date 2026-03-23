# Support

Dextunnel is a local-first beta for people already running Codex sessions.

## Where To Ask For Help

- Bug reports: GitHub Issues
- Feature requests: GitHub Issues
- Security-sensitive reports: `SECURITY.md`
- Setup and operator docs: `README.md` and `docs/index.md`

## Before You Open An Issue

Please include the basics that make a bug report actionable:

1. The Dextunnel surface you are using:
   - web remote
   - macOS menu bar host
   - both
2. Your environment:
   - macOS version
   - browser
   - whether Tailscale is installed and connected
3. The exact commands you ran, if relevant
4. What you expected to happen
5. What actually happened
6. Screenshots or logs when they help

Useful local checks:

```bash
npm run doctor
npm test
npm run test:native
```

If the issue involves a real Codex session, say whether it affects:

- transcript loading
- remote posting
- approvals or tool input
- desktop rehydration
- the app-managed Tailscale host path
