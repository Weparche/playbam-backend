import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ogDir = join(dirname(__dirname), "data", "og-images");

mkdirSync(ogDir, { recursive: true });

export function getInvitationOgImagePath(invitationId) {
  return join(ogDir, `${invitationId}.jpg`);
}

export function readInvitationOgImage(invitationId) {
  const path = getInvitationOgImagePath(invitationId);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path);
}

export function saveInvitationOgImage(invitationId, buffer) {
  const path = getInvitationOgImagePath(invitationId);
  writeFileSync(path, buffer);
  return path;
}

export function parseImageDataUrl(dataUrl) {
  const raw = String(dataUrl ?? "").trim();
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(raw);
  if (!match) {
    return null;
  }
  try {
    return Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
}
