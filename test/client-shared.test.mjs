import test from "node:test";
import assert from "node:assert/strict";

import {
  createRequestError,
  describeRemoteDesktopSyncNote,
  describeRemoteScopeNote,
  describeOperatorDiagnostics,
  describeDesktopSyncNote,
  displayTranscriptText,
  formatCardNote,
  formatRecoveryDuration,
  getSurfaceBootstrap,
  sessionLabel,
  shouldHideTranscriptEntry,
  summarizeRecentTranscript
} from "../public/client-shared.js";

function createSessionStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
}

test("desktop sync note stays honest about selection and rehydration", () => {
  assert.equal(
    describeDesktopSyncNote({
      hasSelectedThread: false,
      status: {}
    }),
    "Select a thread to reveal in Codex."
  );

  assert.equal(
    describeDesktopSyncNote({
      hasSelectedThread: true,
      status: {}
    }),
    "Reveal in Codex opens this thread in the app. Quit and reopen the Codex app manually to see newer messages from Dextunnel."
  );

  assert.equal(
    describeDesktopSyncNote({
      hasSelectedThread: true,
      status: {
        lastWriteForSelection: {
          source: "remote"
        }
      }
    }),
    "Saved here. Reveal in Codex opens the thread there. Quit and reopen the Codex app manually to see new messages."
  );
});

test("remote scope note explains shared-thread semantics without sounding like a new chat", () => {
  assert.equal(
    describeRemoteScopeNote({
      hasSelectedThread: false
    }),
    "Shared room: select a live Codex thread. Drafts and queue stay only on this remote."
  );

  assert.equal(
    describeRemoteScopeNote({
      hasSelectedThread: true,
      channelLabel: "#dextunnel"
    }),
    "Shared room: replies append to #dextunnel on every attached surface. Drafts and queue stay only on this remote."
  );
});

test("remote desktop sync note gets more explicit after a remote write", () => {
  assert.equal(
    describeRemoteDesktopSyncNote({
      hasSelectedThread: false,
      status: {}
    }),
    "Desktop Codex can lag behind remote writes. Reveal in Codex navigates only."
  );

  assert.equal(
    describeRemoteDesktopSyncNote({
      hasSelectedThread: true,
      status: {}
    }),
    "Desktop Codex can lag behind remote writes. Reveal in Codex navigates only; quit and reopen Codex if you need desktop to catch up."
  );

  assert.equal(
    describeRemoteDesktopSyncNote({
      hasSelectedThread: true,
      status: {
        lastWriteForSelection: {
          source: "remote"
        }
      }
    }),
    "Sent here. Dextunnel is current. Desktop Codex may still need a quit and reopen to show this turn."
  );
});

test("request error keeps payload state for immediate client recovery", () => {
  const error = createRequestError(
    {
      error: "Another remote surface currently holds control for this channel.",
      state: {
        selectedThreadId: "thread-1"
      }
    },
    {
      status: 409,
      url: "/api/codex-app-server/control"
    }
  );

  assert.equal(error.message, "Another remote surface currently holds control for this channel.");
  assert.equal(error.status, 409);
  assert.deepEqual(error.state, {
    selectedThreadId: "thread-1"
  });
});

test("operator diagnostics stay actionable and hide known non-actions", () => {
  assert.deepEqual(
    describeOperatorDiagnostics({
      diagnostics: [
        { code: "desktop_restart_required", severity: "info", summary: "Desktop restart required." },
        { code: "host_unavailable", severity: "info", summary: "Host surface not attached." },
        { code: "control_held", severity: "info", summary: "Control is currently held elsewhere." }
      ],
      ownsControl: false,
      status: {
        controlLeaseForSelection: {
          owner: "desktop"
        }
      },
      surface: "remote"
    }),
    [
      {
        code: "host_unavailable",
        detail: "",
        label: "host offline",
        severity: "info",
        title: "Host surface not attached."
      },
      {
        code: "control_held",
        label: "control held by desktop",
        severity: "info",
        title: "Control is currently held elsewhere."
      }
    ]
  );

  assert.deepEqual(
    describeOperatorDiagnostics({
      diagnostics: [
        { code: "host_unavailable", severity: "info", summary: "Host surface not attached." },
        { code: "control_held", severity: "info", summary: "Control is currently held elsewhere." }
      ],
      ownsControl: true,
      status: {
        controlLeaseForSelection: {
          owner: "remote"
        }
      },
      surface: "remote"
    }),
    [
      {
        code: "host_unavailable",
        detail: "",
        label: "host offline",
        severity: "info",
        title: "Host surface not attached."
      }
    ]
  );
});

test("recovery duration stays compact for operator feedback", () => {
  assert.equal(formatRecoveryDuration(950), "0.9s");
  assert.equal(formatRecoveryDuration(1800), "1.8s");
  assert.equal(formatRecoveryDuration(12500), "13s");
});

test("getSurfaceBootstrap prefers a fresh injected token over stored session state", () => {
  const originalWindow = global.window;
  const future = new Date(Date.now() + 60_000).toISOString();
  const staleFuture = new Date(Date.now() + 30_000).toISOString();
  global.window = {
    __DEXTUNNEL_SURFACE_BOOTSTRAP__: {
      accessToken: "fresh-token",
      clientId: "fresh-client",
      expiresAt: future,
      surface: "remote"
    },
    sessionStorage: createSessionStorage({
      "dextunnel:surface-bootstrap:remote": JSON.stringify({
        accessToken: "old-token",
        clientId: "old-client",
        expiresAt: staleFuture,
        surface: "remote"
      })
    })
  };

  try {
    const bootstrap = getSurfaceBootstrap("remote");
    assert.equal(bootstrap.accessToken, "fresh-token");
    assert.equal(bootstrap.clientId, "fresh-client");

    const persisted = JSON.parse(global.window.sessionStorage.getItem("dextunnel:surface-bootstrap:remote"));
    assert.equal(persisted.accessToken, "fresh-token");
    assert.equal(persisted.clientId, "fresh-client");
  } finally {
    global.window = originalWindow;
  }
});

test("summarizeRecentTranscript keeps a short recap of recent conversation turns", () => {
  assert.equal(
    summarizeRecentTranscript([
      {
        role: "assistant",
        kind: "commentary",
        text: "checking the bridge"
      },
      {
        role: "user",
        text: "please make the mobile composer smaller"
      },
      {
        role: "assistant",
        text: "i tightened the compact layout and rebuilt the app"
      }
    ]),
    "you: please make the mobile composer smaller | codex: i tightened the compact layout and rebuilt the app"
  );
});

test("shouldHideTranscriptEntry suppresses leaked internal context envelopes", () => {
  assert.equal(
    shouldHideTranscriptEntry({
      role: "user",
      text: `<permissions instructions>
Filesystem sandboxing defines which files can be read or written.
</permissions instructions>`
    }),
    true
  );

  assert.equal(
    shouldHideTranscriptEntry({
      role: "user",
      text: `# Internal workflow instructions for /Users/zsolt/dev/codex/dextunnel

<INSTRUCTIONS>
Use the repository workflow docs.
</INSTRUCTIONS>`
    }),
    true
  );

  assert.equal(
    shouldHideTranscriptEntry({
      role: "user",
      text: `<environment_context>
  <cwd>/Users/zsolt/dev/codex/dextunnel</cwd>
</environment_context>`
    }),
    true
  );
});

test("shouldHideTranscriptEntry keeps ordinary workflow references visible", () => {
  assert.equal(
    shouldHideTranscriptEntry({
      role: "user",
      text: "please check the repo workflow notes before you edit anything"
    }),
    false
  );
});

test("summarizeRecentTranscript skips leaked internal context entries", () => {
  assert.equal(
    summarizeRecentTranscript([
      {
        role: "assistant",
        text: "checking the bridge"
      },
      {
        role: "user",
        text: `<environment_context>
  <cwd>/Users/zsolt/dev/codex/dextunnel</cwd>
</environment_context>`
      },
      {
        role: "assistant",
        text: "the feed should stay clean now"
      }
    ]),
    "codex: checking the bridge | codex: the feed should stay clean now"
  );
});

test("displayTranscriptText compacts tool output to the first meaningful line by default", () => {
  const entry = {
    role: "tool",
    text: `

Command: /bin/bash -lc "npm test"
Chunk ID: abc123
Wall time: 0.5 seconds
Output:
ok
`
  };

  assert.equal(
    displayTranscriptText(entry),
    "ok"
  );

  assert.match(displayTranscriptText(entry, { expanded: true }), /Chunk ID: abc123/);
});

test("sessionLabel prefers stable channel labels over preview text", () => {
  const label = sessionLabel({
    channelLabel: "dextunnel",
    cwd: "/Users/zsolt/dev/codex/dextunnel",
    name: "dextunnel",
    preview: "$codex-repo-bootstrap",
    updatedAt: 1774207506
  });

  assert.match(label, /^dextunnel - /);
});

test("sessionLabel keeps repo-matching thread names instead of opener preview text", () => {
  assert.equal(
    sessionLabel({
      cwd: "/Users/zsolt/dev/codex/dextunnel",
      name: "dextunnel",
      preview: "$codex-repo-bootstrap",
      updatedAt: null
    }),
    "dextunnel"
  );
});

test("displayTranscriptText compacts updated-file output into a file summary", () => {
  const entry = {
    role: "tool",
    text: `
Success. Updated the following files:
M /Users/zsolt/dev/codex/dextunnel/public/remote.js
M /Users/zsolt/dev/codex/dextunnel/public/styles.css
M /Users/zsolt/dev/codex/dextunnel/public/client-shared.js
`
  };

  assert.equal(
    displayTranscriptText(entry),
    "Updated files: remote.js, styles.css, client-shared.js"
  );
});

test("displayTranscriptText unwraps browser-farm JSON envelopes to a readable summary", () => {
  const entry = {
    role: "tool",
    text: JSON.stringify([
      {
        type: "text",
        text: "### Ran Playwright code\n```js\nawait page.goto('http://example.test');\n```\n### Page\n- Page URL: http://example.test\n- Page Title: Example"
      }
    ])
  };

  assert.equal(
    displayTranscriptText(entry),
    "Ran Playwright code // http://example.test"
  );

  assert.equal(
    displayTranscriptText(entry, { expanded: true }),
    "Ran Playwright code // http://example.test\n\nawait page.goto('http://example.test');\n\nPage URL: http://example.test\nPage Title: Example"
  );
});

test("displayTranscriptText handles object-array tool payloads without leaking object coercion", () => {
  const entry = {
    role: "tool",
    text: [
      {
        type: "text",
        text: "### Open tabs\n- 0: [Example] (http://example.test)"
      },
      {
        type: "text",
        text: "### Page\n- Page URL: http://example.test"
      }
    ]
  };

  assert.equal(displayTranscriptText(entry), "Open tabs");
});

test("displayTranscriptText unwraps escaped Playwright envelopes to a readable summary", () => {
  const entry = {
    role: "tool",
    text:
      '[{\\"type\\":\\"text\\",\\"text\\":\\"### Ran Playwright code\\\\n```js\\\\nawait page.goto(\\\'http://example.test\\\');\\\\n```\\\\n### Page\\\\n- Page URL: http://example.test\\\\n- Page Title: Example\\"}]'
  };

  assert.equal(
    displayTranscriptText(entry),
    "Ran Playwright code // http://example.test"
  );
});

test("displayTranscriptText unwraps double-encoded Playwright envelopes", () => {
  const envelope = JSON.stringify([
    {
      type: "text",
      text: "### Ran Playwright code\n```js\nawait page.goto('http://example.test');\n```\n### Open tabs\n- 0: [Example] (http://example.test)"
    }
  ]);
  const entry = {
    role: "tool",
    text: JSON.stringify(envelope)
  };

  assert.equal(
    displayTranscriptText(entry),
    "Ran Playwright code"
  );

  assert.equal(
    displayTranscriptText(entry, { expanded: true }),
    "Ran Playwright code\n\nawait page.goto('http://example.test');"
  );
});

test("displayTranscriptText humanizes truncated escaped Playwright envelopes", () => {
  assert.equal(
    displayTranscriptText({
      role: "tool",
      text: '[{\\"type\\":\\"text\\",\\"text\\":\\"### Open tabs'
    }),
    "Open tabs"
  );

  assert.equal(
    displayTranscriptText({
      role: "tool",
      text: '[{\\"type\\":\\"text\\",\\"text\\":\\"### Result'
    }),
    "Playwright result"
  );
});

test("displayTranscriptText unwraps partial output envelopes", () => {
  assert.equal(
    displayTranscriptText({
      role: "tool",
      text: '{"output":"Success. Updated the following files:\\nM /Users/zsolt/dev/codex/dextunnel/public/remote.js"}'
    }),
    "Updated files: remote.js"
  );
});

test("displayTranscriptText expands partially captured direct Playwright envelopes cleanly", () => {
  const entry = {
    role: "tool",
    text:
      '[{"type":"text","text":"### Ran Playwright code\\n```js\\nawait page.goto(\'http://example.test\');\\n```\\n### Open tabs\\n- 0: [Example] (http://example.test)"}]'
  };

  assert.equal(
    displayTranscriptText(entry),
    "Ran Playwright code"
  );

  assert.equal(
    displayTranscriptText(entry, { expanded: true }),
    "Ran Playwright code\n\nawait page.goto('http://example.test');"
  );
});

test("formatCardNote omits redundant update note for commentary cards", () => {
  assert.equal(
    formatCardNote({
      role: "assistant",
      kind: "commentary"
    }),
    ""
  );
});
