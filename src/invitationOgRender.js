import { readOgRenderCache, writeOgRenderCache } from "./invitationOgCache.js";
import { renderInvitationOgPng } from "./invitationOgImage.js";
import { compositeCardImageToOgFormat } from "./invitationOgComposite.js";
import { readInvitationOgImage } from "./invitationOgStorage.js";
import { renderInvitationOgScreenshot } from "./invitationOgScreenshot.js";

/** Playwright screenshot prave pozivnice (zadano). OG_USE_SCREENSHOT=false ga isključuje. */
const usePlaywrightScreenshot = process.env.OG_USE_SCREENSHOT !== "false";

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

/**
 * JPEG OG slika (keširana po slug + updatedAt — sljedeći zahtjevi su brzi).
 */
export async function renderInvitationOgImage(invitation, slug, webBaseUrl) {
  const token = String(slug ?? invitation?.publicSlug ?? invitation?.shareToken ?? "").trim();
  const version = cacheVersion(invitation);

  if (token) {
    const cached = readOgRenderCache(token, version);
    if (cached) {
      return cached;
    }
  }

  const jpeg = await generateOgImage(invitation, slug, webBaseUrl);

  if (token && jpeg?.length) {
    writeOgRenderCache(token, version, jpeg);
  }

  return jpeg;
}
