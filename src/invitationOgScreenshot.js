import { compositeCardImageToOgFormat } from "./invitationOgComposite.js";

const CAPTURE_VIEWPORT = { width: 600, height: 1334 };
const CAPTURE_DEVICE_SCALE = 2;

function getCaptureSlug(slug) {
  return encodeURIComponent(String(slug ?? "").trim());
}

async function getChromium() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error("PLAYWRIGHT_NOT_INSTALLED");
  }
  return playwright.chromium;
}

async function captureCardJpeg(slug, webBaseUrl) {
  const origin = String(webBaseUrl ?? "https://vidimose.hr").replace(/\/$/, "");
  const captureUrl = `${origin}/pozivnica/${getCaptureSlug(slug)}?ogCapture=1`;
  const chromium = await getChromium();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: CAPTURE_VIEWPORT,
    deviceScaleFactor: CAPTURE_DEVICE_SCALE,
    locale: "hr-HR",
  });

  const page = await context.newPage();

  try {
    await page.goto(captureUrl, { waitUntil: "load", timeout: 45_000 });
    await page.waitForSelector('[data-og-status="ready"]', { timeout: 30_000 });
    await page.waitForSelector(".pb-inviteCard--storybook", { state: "visible", timeout: 15_000 });
    await page.waitForSelector(".pb-inviteHero__rsvpBlock--storybook", {
      state: "visible",
      timeout: 15_000,
    });
    await page.waitForFunction(
      () => {
        const media = document.querySelector(".pb-inviteHero__image--storybook");
        if (media instanceof HTMLImageElement) {
          return media.complete && media.naturalWidth > 0;
        }
        if (media instanceof HTMLVideoElement) {
          return media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && media.videoWidth > 0;
        }
        return false;
      },
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      () => {
        const buttons = document.querySelectorAll(
          ".pb-inviteHero__rsvpButtons--storybook .pb-rsvpBtn--storybook",
        );
        if (buttons.length < 3) {
          return false;
        }
        const emojiImgs = document.querySelectorAll(".pb-rsvpBtn__emoji--capture");
        if (emojiImgs.length > 0) {
          return [...emojiImgs].every(
            (node) =>
              node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0,
          );
        }
        return document.querySelectorAll(".pb-rsvpBtn__emoji").length >= 3;
      },
      { timeout: 20_000 },
    );
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });
    await page.waitForTimeout(200);

    const cardJpeg = await page.locator(".pb-inviteCard--storybook").screenshot({
      type: "jpeg",
      quality: 84,
      animations: "disabled",
    });

    return compositeCardImageToOgFormat(cardJpeg);
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * Headless screenshot iste React pozivnice kao na /pozivnica/:slug (?ogCapture=1).
 * Browser se zatvara nakon svakog rendera (ne drži Chromium u memoriji).
 */
export async function renderInvitationOgScreenshot(slug, webBaseUrl) {
  return captureCardJpeg(slug, webBaseUrl);
}
