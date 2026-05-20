import { renderInvitationOgPng } from "./invitationOgImage.js";
import { compositeCardImageToOgFormat } from "./invitationOgComposite.js";
import { readInvitationOgImage } from "./invitationOgStorage.js";
import { renderInvitationOgScreenshot } from "./invitationOgScreenshot.js";

/** Playwright screenshot prave pozivnice (zadano). OG_USE_SCREENSHOT=false ga isključuje. */
const usePlaywrightScreenshot = process.env.OG_USE_SCREENSHOT !== "false";

export async function renderInvitationOgImage(invitation, slug, webBaseUrl) {
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

  return renderInvitationOgPng(invitation, webBaseUrl);
}
