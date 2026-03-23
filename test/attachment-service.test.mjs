import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { createAttachmentService } from "../src/lib/attachment-service.mjs";

test("attachment service persists base64 image attachments as localImage items", async () => {
  const attachmentDir = await mkdtemp(path.join(tmpdir(), "dextunnel-attachments-"));
  const service = createAttachmentService({
    attachmentDir,
    maxAgeMs: 60_000,
    randomId: () => "fixed-id"
  });

  const payload = await service.persistImageAttachments([
    {
      dataUrl: `data:image/png;base64,${Buffer.from("hello").toString("base64")}`,
      name: "Hello world.png"
    }
  ]);

  assert.equal(payload.length, 1);
  assert.equal(payload[0].type, "localImage");
  assert.match(payload[0].path, /fixed-id-0-Hello-world\.png$/);
  assert.equal(await readFile(payload[0].path, "utf8"), "hello");
});

test("attachment service cleanup removes stale files", async () => {
  const attachmentDir = await mkdtemp(path.join(tmpdir(), "dextunnel-attachments-"));
  const oldPath = path.join(attachmentDir, "old.png");
  const freshPath = path.join(attachmentDir, "fresh.png");
  await writeFile(oldPath, "old", "utf8");
  await writeFile(freshPath, "fresh", "utf8");

  const oldTime = new Date(Date.now() - 10_000);
  await utimes(oldPath, oldTime, oldTime);

  const service = createAttachmentService({
    attachmentDir,
    maxAgeMs: 2_000
  });

  await service.cleanupAttachmentDir({
    now: Date.now(),
    maxAgeMs: 2_000
  });

  await assert.rejects(stat(oldPath));
  assert.equal(await readFile(freshPath, "utf8"), "fresh");
});

test("attachment service rejects non-image data URLs", async () => {
  const attachmentDir = await mkdtemp(path.join(tmpdir(), "dextunnel-attachments-"));
  const service = createAttachmentService({
    attachmentDir,
    maxAgeMs: 60_000
  });

  await assert.rejects(
    service.persistImageAttachments([
      {
        dataUrl: `data:text/plain;base64,${Buffer.from("nope").toString("base64")}`,
        name: "bad.txt"
      }
    ]),
    /base64 image data URL/
  );
});
