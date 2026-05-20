import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(dirname(__dirname), "data", "og-render-cache");

mkdirSync(cacheDir, { recursive: true });

function cachePath(slug, version) {
  const safeSlug = String(slug ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 80) || "invite";
  const versionHash = createHash("sha256")
    .update(String(version ?? ""))
    .digest("hex")
    .slice(0, 12);
  return join(cacheDir, `${safeSlug}-${versionHash}.jpg`);
}

export function readOgRenderCache(slug, version) {
  const path = cachePath(slug, version);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path);
}

export function writeOgRenderCache(slug, version, buffer) {
  writeFileSync(cachePath(slug, version), buffer);
}
