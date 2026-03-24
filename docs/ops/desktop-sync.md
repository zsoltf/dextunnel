# Desktop Visibility Contract

Date: 2026-03-19

## Current truth

- Dextunnel writes to the real persisted Codex session store.
- Dextunnel reads those writes back immediately through `codex app-server`.
- The stock Codex desktop app does not currently hot-reconcile those out-of-band writes in a proven way.
- The only confirmed desktop rehydrate path today is a full Codex app restart.

## What `Reveal in Codex` means

- `Reveal in Codex` is a navigation convenience.
- It brings the desktop app to the selected thread.
- It is not a guaranteed live visibility or rehydrate action.

## What manual desktop recovery means

- Manual desktop recovery means quitting and reopening the Codex app yourself when you want the desktop UI to rehydrate newer turns written through Dextunnel.
- Dextunnel does not automate that restart in the default product path.
- This keeps the recovery contract honest and avoids extra permission prompts for an action the operator should choose deliberately.

## What we tried and what failed

- Deeplink reopen:
  - negative
- `thread/resume`:
  - server-side success
  - negative for desktop view visibility
- Desktop navigation:
  - `View -> Back` then `View -> Forward`: negative
  - `View -> Previous Thread` then `View -> Next Thread`: negative
- Manual reopen from the desktop thread list:
  - negative

## Confirmed recovery path

1. Verify the thread looks correct in Dextunnel.
2. Use `Reveal in Codex` if you want the desktop app on the same thread.
3. Quit and reopen the Codex app manually when you need the desktop app to rehydrate newly written turns.
4. After Codex desktop updates, run:

```bash
npm run smoke:desktop-rehydration -- --thread-id <thread-id> --cwd <repo-cwd>
```

## Product language to keep honest

- Good:
  - `Saved here. Reveal in Codex opens the thread there. Quit and reopen the Codex app manually to see new messages.`
  - `Reveal in Codex opens this thread in the app. Quit and reopen the Codex app manually to see newer messages from Dextunnel.`
- Avoid:
  - claiming the desktop app is fully live-synced with Dextunnel
  - implying `Reveal in Codex` is a visibility guarantee
