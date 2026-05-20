import sharp from "sharp";

/** Širina OG slike (portret — ista proporcija kao web pozivnica). */
export const OG_MAX_WIDTH = 1200;

/** Meta tagovi za WhatsApp (približan omjer nakon skaliranja). */
export const OG_META_WIDTH = OG_MAX_WIDTH;
export const OG_META_HEIGHT = 2600;

/**
 * Izreže padding, zadrži portret, bez bijelog letterboxa (contain na 1200×630).
 */
export async function prepareInvitationOgImage(cardBuffer) {
  const trimmed = await sharp(cardBuffer)
    .trim({
      threshold: 14,
      background: { r: 255, g: 250, b: 245 },
    })
    .png()
    .toBuffer();

  const meta = await sharp(trimmed).metadata();
  const srcW = meta.width ?? 780;
  const srcH = meta.height ?? 1600;
  const targetW = Math.min(OG_MAX_WIDTH, srcW);
  const targetH = Math.max(1, Math.round((srcH * targetW) / srcW));

  const png = await sharp(trimmed)
    .resize(targetW, targetH, { fit: "fill" })
    .png({ quality: 92, compressionLevel: 8 })
    .toBuffer();

  return { png, width: targetW, height: targetH };
}

export async function compositeCardImageToOgFormat(cardBuffer) {
  const { png } = await prepareInvitationOgImage(cardBuffer);
  return png;
}
