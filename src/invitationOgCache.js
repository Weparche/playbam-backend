import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(dirname(__dirname), "data", "og-render-cache");

mkdirSync(cacheDir, { recursive: true });

function safeSlug(slug) {
  return (
    String(slug ?? "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 80) || "invite"
  );
}

function cachePath(slug, version) {
  const versionHash = createHash("sha256")
    .update(String(version ?? ""))
    .digest("hex")
    .slice(0, 12);
  return join(cacheDir, `${safeSlug(slug)}-${versionHash}.jpg`);
}

export function readOgRenderCache(slug, version) {
  const path = cachePath(slug, version);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path);
}

/** Zadnji keširani OG za slug (bilo koja verzija) — za brzi odgovor dok se regenerira. */
export function readLatestOgRenderCacheForSlug(slug) {
  const prefix = `${safeSlug(slug)}-`;
  let bestPath = null;
  let bestMtime = 0;

  for (const name of readdirSync(cacheDir)) {
    if (!name.startsWith(prefix) || !name.endsWith(".jpg")) {
      continue;
    }
    const fullPath = join(cacheDir, name);
    const mtime = statSync(fullPath).mtimeMs;
    if (mtime > bestMtime) {
      bestMtime = mtime;
      bestPath = fullPath;
    }
  }

  return bestPath ? readFileSync(bestPath) : null;
}

export function writeOgRenderCache(slug, version, buffer) {
  writeFileSync(cachePath(slug, version), buffer);
}
