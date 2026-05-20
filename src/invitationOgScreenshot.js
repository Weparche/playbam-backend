import { compositeCardImageToOgFormat } from "./invitationOgComposite.js";

const CAPTURE_VIEWPORT = { width: 430, height: 960 };

let browserPromise = null;

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

async function getBrowser() {
  if (!browserPromise) {
    const chromium = await getChromium();
    browserPromise = chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browserPromise;
}

/**
 * Headless screenshot iste React pozivnice kao na /pozivnica/:slug (?ogCapture=1).
 * Zahtijeva: npm install playwright && npx playwright install chromium
 */
export async function renderInvitationOgScreenshot(slug, webBaseUrl) {
  const origin = String(webBaseUrl ?? "https://vidimose.hr").replace(/\/$/, "");
  const captureUrl = `${origin}/pozivnica/${getCaptureSlug(slug)}?ogCapture=1`;
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: CAPTURE_VIEWPORT,
    deviceScaleFactor: 2,
    locale: "hr-HR",
  });

  const page = await context.newPage();

  try {
    await page.goto(captureUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForSelector('[data-og-status="ready"]', { timeout: 30_000 });
    await page.waitForSelector(".pb-inviteCard--storybook", { state: "visible", timeout: 15_000 });
    await page.waitForSelector(".pb-inviteHero__rsvpBlock--storybook", {
      state: "visible",
      timeout: 15_000,
    });
    await page.waitForFunction(
      () => {
        const img = document.querySelector(".pb-inviteHero__image--storybook");
        return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
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
    await page.waitForTimeout(300);

    const cardPng = await page.locator(".pb-inviteCard--storybook").screenshot({
      type: "png",
      animations: "disabled",
    });

    return compositeCardImageToOgFormat(cardPng);
  } finally {
    await context.close();
  }
}
