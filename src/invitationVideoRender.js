import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const CAPTURE_VIEWPORT = { width: 760, height: 1300 };
const VIDEO_DURATION_MS = 6000;

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

function runFfmpeg(args) {
  if (!ffmpegPath) {
    throw new Error("FFMPEG_NOT_INSTALLED");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFMPEG_FAILED_${code}: ${stderr.slice(-1200)}`));
    });
  });
}

async function renderPageRecording(slug, webBaseUrl, outputDir) {
  const origin = String(webBaseUrl ?? "https://vidimose.hr").replace(/\/$/, "");
  const captureUrl = `${origin}/pozivnica/${getCaptureSlug(slug)}?ogCapture=1`;
  const chromium = await getChromium();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: CAPTURE_VIEWPORT,
    deviceScaleFactor: 1,
    locale: "hr-HR",
    recordVideo: {
      dir: outputDir,
      size: CAPTURE_VIEWPORT,
    },
  });

  const page = await context.newPage();

  try {
    await page.goto(captureUrl, { waitUntil: "load", timeout: 45_000 });
    await page.waitForSelector('[data-og-status="ready"]', { timeout: 30_000 });
    await page.waitForSelector(".pb-inviteCard--storybook", { state: "visible", timeout: 15_000 });
    await page.waitForFunction(
      () => {
        const media = document.querySelector(".pb-inviteHero__image--storybook");
        if (media instanceof HTMLImageElement) {
          return media.complete && media.naturalWidth > 0;
        }
        if (media instanceof HTMLVideoElement) {
          media.currentTime = 0;
          void media.play().catch(() => undefined);
          return media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && media.videoWidth > 0;
        }
        return false;
      },
      { timeout: 15_000 },
    );
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      const video = document.querySelector(".pb-inviteHero__image--storybook");
      if (video instanceof HTMLVideoElement) {
        video.currentTime = 0;
        await video.play().catch(() => undefined);
      }
    });
    await page.waitForTimeout(VIDEO_DURATION_MS);
    const video = page.video();
    await context.close();
    await browser.close();
    if (!video) {
      throw new Error("PLAYWRIGHT_VIDEO_NOT_CREATED");
    }
    return await video.path();
  } catch (err) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw err;
  }
}

export async function renderInvitationShareVideo(slug, webBaseUrl) {
  const tempDir = mkdtempSync(join(tmpdir(), "playbam-invite-video-"));
  const outputPath = join(tempDir, "pozivnica.mp4");

  try {
    const recordedWebmPath = await renderPageRecording(slug, webBaseUrl, tempDir);
    await runFfmpeg([
      "-y",
      "-i",
      recordedWebmPath,
      "-t",
      String(VIDEO_DURATION_MS / 1000),
      "-an",
      "-vf",
      "fps=30,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return readFileSync(outputPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
