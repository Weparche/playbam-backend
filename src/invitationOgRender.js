import {
  readLatestOgRenderCacheForSlug,
  readOgRenderCache,
  writeOgRenderCache,
} from "./invitationOgCache.js";
import { withOgRenderLock } from "./invitationOgLock.js";
import { renderInvitationOgPng } from "./invitationOgImage.js";
import { compositeCardImageToOgFormat } from "./invitationOgComposite.js";
import { readInvitationOgImage } from "./invitationOgStorage.js";
import { renderInvitationOgScreenshot } from "./invitationOgScreenshot.js";

const usePlaywrightScreenshot = process.env.OG_USE_SCREENSHOT !== "false";
const staleWhileRevalidate = process.env.OG_STALE_WHILE_REVALIDATE !== "false";

const inFlightBySlug = new Map();

function cacheVersion(invitation) {
  return String(invitation?.updatedAt ?? invitation?.updated_at ?? "").trim() || "v0";
}

async function generateOgImage(invitation, slug, webBaseUrl) {
  const token = String(slug ?? invitation?.publicSlug ?? invitation?.shareToken ?? "").trim();

  if (usePlaywrightScreenshot && token) {
    try {
      return await renderInvitationOgScreenshot(token, webBaseUrl);
    } catch (err) {
      console.warn(
        "OG Playwright screenshot failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const stored = invitation?.id ? readInvitationOgImage(invitation.id) : null;
  if (stored) {
    return compositeCardImageToOgFormat(stored);
  }

  const fallback = await renderInvitationOgPng(invitation, webBaseUrl);
  return compositeCardImageToOgFormat(fallback);
}

function scheduleBackgroundRegeneration(token, version, invitation, slug, webBaseUrl) {
  if (inFlightBySlug.has(token)) {
    return;
  }

  const job = withOgRenderLock(async () => {
    const jpeg = await generateOgImage(invitation, slug, webBaseUrl);
    if (jpeg?.length) {
      writeOgRenderCache(token, version, jpeg);
    }
    return jpeg;
  }).finally(() => {
    inFlightBySlug.delete(token);
  });

  inFlightBySlug.set(token, job);
  job.catch((err) => {
    console.warn("OG background regeneration failed:", err instanceof Error ? err.message : err);
  });
}

/**
 * JPEG OG slika — keš + zastarjeli keš odmah, regeneracija u pozadini.
 */
export async function renderInvitationOgImage(invitation, slug, webBaseUrl) {
  const token = String(slug ?? invitation?.publicSlug ?? invitation?.shareToken ?? "").trim();
  const version = cacheVersion(invitation);

  if (token) {
    const fresh = readOgRenderCache(token, version);
    if (fresh) {
      return fresh;
    }

    if (staleWhileRevalidate) {
      const stale = readLatestOgRenderCacheForSlug(token);
      if (stale) {
        scheduleBackgroundRegeneration(token, version, invitation, slug, webBaseUrl);
        return stale;
      }
    }
  }

  const jpeg = await withOgRenderLock(() => generateOgImage(invitation, slug, webBaseUrl));

  if (token && jpeg?.length) {
    writeOgRenderCache(token, version, jpeg);
  }

  return jpeg;
}
