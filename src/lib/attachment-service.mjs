import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";

function extensionFromMimeType(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Attachment must be a base64 image data URL.");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function sanitizeAttachmentName(name, fallbackExt) {
  const stem = String(name || "image")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "image";

  return `${stem}.${fallbackExt}`;
}

export function createAttachmentService({
  attachmentDir,
  maxAgeMs,
  mkdirFn = mkdir,
  randomId = () => randomUUID(),
  readdirFn = readdir,
  statFn = stat,
  unlinkFn = unlink,
  writeFileFn = writeFile
} = {}) {
  if (!attachmentDir) {
    throw new Error("createAttachmentService requires an attachmentDir.");
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error("createAttachmentService requires a positive maxAgeMs.");
  }

  async function cleanupAttachmentDir({ now = Date.now(), maxAgeMs: nextMaxAgeMs = maxAgeMs } = {}) {
    try {
      const entries = await readdirFn(attachmentDir, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          if (!entry.isFile()) {
            return;
          }

          const filePath = path.join(attachmentDir, entry.name);
          try {
            const fileStat = await statFn(filePath);
            if (now - fileStat.mtimeMs > nextMaxAgeMs) {
              await unlinkFn(filePath);
            }
          } catch {
            return;
          }
        })
      );
    } catch {
      return;
    }
  }

  async function persistImageAttachments(attachments = []) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return [];
    }

    await cleanupAttachmentDir();
    await mkdirFn(attachmentDir, { recursive: true });

    return Promise.all(
      attachments.map(async (attachment, index) => {
        const { buffer, mimeType } = parseImageDataUrl(attachment.dataUrl);
        const ext = extensionFromMimeType(attachment.type || mimeType);
        const baseName = sanitizeAttachmentName(attachment.name, ext);
        const filePath = path.join(attachmentDir, `${randomId()}-${index}-${baseName}`);
        await writeFileFn(filePath, buffer);
        return {
          path: filePath,
          type: "localImage"
        };
      })
    );
  }

  return {
    cleanupAttachmentDir,
    persistImageAttachments
  };
}

export {
  extensionFromMimeType,
  parseImageDataUrl,
  sanitizeAttachmentName
};
