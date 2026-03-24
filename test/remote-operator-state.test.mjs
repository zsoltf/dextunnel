import test from "node:test";
import assert from "node:assert/strict";

import {
  canSteerReply,
  composeBlockedReason,
  canQueueReply,
  cloneReplyAttachments,
  controlClaimRequired,
  controlEventStatus,
  controlBlockedReason,
  controlReleaseFeedback,
  controlReleaseStatus,
  createQueuedReply,
  defaultComposerStatus,
  queueSummary,
  scopedThreadStorageKey,
  sendBlockedReason,
  sessionBlockedReason,
  shouldFlushQueuedReplies,
  threadBusy
} from "../public/remote-operator-state.js";

test("queued reply creation trims text and clones attachments", () => {
  const attachments = [
    {
      dataUrl: "data:image/png;base64,abc",
      id: "image-1",
      name: "shot.png",
      size: 128,
      type: "image/png"
    }
  ];

  const reply = createQueuedReply({
    attachments,
    queuedAt: "2026-03-18T22:35:00.000Z",
    rawText: "  keep going  ",
    sequence: 7,
    threadId: "thread-1"
  });

  assert.equal(reply.threadId, "thread-1");
  assert.equal(reply.text, "keep going");
  assert.equal(reply.queuedAt, "2026-03-18T22:35:00.000Z");
  assert.match(reply.id, /^queued-reply-\d+-7$/);
  assert.deepEqual(reply.attachments, attachments);
  assert.notEqual(reply.attachments, attachments);
  assert.notEqual(reply.attachments[0], attachments[0]);
});

test("queue summary and busy helpers stay literal", () => {
  assert.equal(queueSummary(0), "");
  assert.equal(queueSummary(1), "1 queued");
  assert.equal(queueSummary(3), "3 queued");

  assert.equal(threadBusy({}), false);
  assert.equal(threadBusy({ activeTurnId: "turn-1" }), true);
  assert.equal(threadBusy({ writeLockStatus: "running" }), true);
  assert.equal(threadBusy({ threadStatus: { type: "inProgress" } }), true);
  assert.equal(threadBusy({ threadStatus: "idle" }), false);
});

test("queue availability allows storing intent whenever the session is writable", () => {
  assert.equal(
    canQueueReply({
      controlActive: false,
      hasDraftPayload: true,
      queuedCount: 0,
      threadBusy: false,
      threadId: "thread-1"
    }),
    true
  );

  assert.equal(
    canQueueReply({
      controlActive: true,
      hasDraftPayload: true,
      queuedCount: 0,
      threadBusy: false,
      threadId: "thread-1"
    }),
    true
  );
});

test("default composer status explains queueing and busy transitions", () => {
  assert.equal(
    defaultComposerStatus({
      composerStatus: "Ready",
      composerStatusTone: "neutral",
      controlActive: false,
      hasDraftPayload: true
    }),
    "Steer now takes control. Queue stays local."
  );

  assert.equal(
    defaultComposerStatus({
      composerStatus: "Ready",
      composerStatusTone: "neutral",
      controlActive: false,
      queuedCount: 2
    }),
    "2 queued. Sending soon."
  );

  assert.equal(
    defaultComposerStatus({
      composerStatus: "Ready",
      composerStatusTone: "neutral",
      controlActive: true,
      queuedCount: 1,
      threadBusy: true
    }),
    "1 queued. Waiting for idle."
  );

  assert.equal(
    defaultComposerStatus({
      composerStatus: "Ready",
      composerStatusTone: "neutral",
      controlActive: false,
      threadBusy: true
    }),
    "Codex is busy. Queue now; it will send when idle."
  );
});

test("steer helpers distinguish missing control from actual conflicts", () => {
  assert.equal(controlClaimRequired("Take control to send from remote."), true);
  assert.equal(controlClaimRequired("Desktop lane currently has control."), false);

  assert.equal(
    canSteerReply({
      blockedReason: "Take control to send from remote.",
      hasDraftPayload: true,
      threadId: "thread-1"
    }),
    true
  );

  assert.equal(
    canSteerReply({
      blockedReason: "Desktop lane currently has control.",
      hasDraftPayload: true,
      threadId: "thread-1"
    }),
    false
  );
});

test("control release and flush gating stay explicit", () => {
  assert.equal(controlReleaseStatus({ hasDraft: true }), "Remote control released. Draft kept.");
  assert.equal(controlReleaseStatus({ hasDraft: false }), "Remote control released.");
  assert.equal(
    controlEventStatus({
      event: {
        action: "claim"
      },
      hasDraft: false,
      isLocalActor: true,
      queuedCount: 2
    }),
    "Remote control reclaimed. 2 queued. Sending soon."
  );

  assert.equal(
    controlEventStatus({
      event: {
        action: "release",
        actor: "host"
      },
      hasDraft: true,
      queuedCount: 1
    }),
    "Remote control released by host. 1 queued. Waiting for control."
  );

  assert.equal(
    controlEventStatus({
      event: {
        action: "release",
        cause: "expired"
      },
      hasDraft: true,
      queuedCount: 0
    }),
    "Remote control expired. Draft kept."
  );

  assert.equal(
    controlReleaseFeedback({
      eventAction: "release",
      hasDraft: true
    }),
    "Remote control released. Draft kept."
  );
  assert.equal(
    controlReleaseFeedback({
      hasDraft: false,
      nextHasRemoteControl: false,
      previousHadRemoteControl: true
    }),
    "Remote control released."
  );
  assert.equal(
    controlReleaseFeedback({
      eventAction: "release",
      hasDraft: true,
      isSendingReply: true
    }),
    ""
  );

  assert.equal(
    shouldFlushQueuedReplies({
      blockedReason: "",
      hasInFlight: false,
      isSendingReply: false,
      queuedCount: 1,
      threadBusy: false,
      threadId: "thread-1"
    }),
    true
  );

  assert.equal(
    shouldFlushQueuedReplies({
      blockedReason: "Take control to send from remote.",
      hasInFlight: false,
      isSendingReply: false,
      queuedCount: 1,
      threadBusy: false,
      threadId: "thread-1"
    }),
    true
  );
});

test("session, compose, and control blocking stay explicit", () => {
  assert.equal(sessionBlockedReason({ hasLiveThread: false }), "No live session selected.");
  assert.equal(
    sessionBlockedReason({ hasLiveThread: true, watcherConnected: false }),
    "Live watcher offline."
  );
  assert.equal(
    composeBlockedReason({
      pendingInteraction: true,
      sessionReason: ""
    }),
    "Resolve the pending action first."
  );
  assert.equal(
    controlBlockedReason({
      hasAnyRemoteControl: true,
      hasRemoteControl: false,
      ownerLabel: "Host lane",
      threadId: "thread-1"
    }),
    "Host lane currently has control."
  );
  assert.equal(
    sendBlockedReason({
      hasAnyRemoteControl: false,
      hasRemoteControl: false,
      ownerLabel: "",
      pendingInteraction: false,
      sessionReason: "",
      threadId: "thread-1"
    }),
    "Take control to send from remote."
  );
  assert.equal(
    sendBlockedReason({
      hasAnyRemoteControl: true,
      hasRemoteControl: false,
      ownerLabel: "Desktop lane",
      pendingInteraction: false,
      sessionReason: "",
      threadId: "thread-1"
    }),
    "Desktop lane currently has control."
  );
});

test("attachment cloning helper preserves shape without sharing references", () => {
  const cloned = cloneReplyAttachments([
    {
      dataUrl: "data:text/plain;base64,abc",
      id: "one",
      name: "note.txt",
      size: 42,
      type: "text/plain"
    }
  ]);

  assert.deepEqual(cloned, [
    {
      dataUrl: "data:text/plain;base64,abc",
      id: "one",
      name: "note.txt",
      size: 42,
      type: "text/plain"
    }
  ]);
});

test("scopedThreadStorageKey keeps local draft and queue storage isolated per surface", () => {
  assert.equal(
    scopedThreadStorageKey({
      prefix: "dextunnel:draft:",
      scopeId: "remote-a",
      threadId: "thread-1"
    }),
    "dextunnel:draft:remote-a:thread-1"
  );

  assert.notEqual(
    scopedThreadStorageKey({
      prefix: "dextunnel:queue:",
      scopeId: "remote-a",
      threadId: "thread-1"
    }),
    scopedThreadStorageKey({
      prefix: "dextunnel:queue:",
      scopeId: "remote-b",
      threadId: "thread-1"
    })
  );
});
