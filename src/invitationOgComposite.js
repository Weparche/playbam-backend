import sharp from "sharp";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Umetne izvoz kartice (JPG/PNG) u standardni OG format. */
export async function compositeCardImageToOgFormat(cardBuffer) {
  const cardMeta = await sharp(cardBuffer).metadata();
  const cardWidth = cardMeta.width ?? 400;
  const cardHeight = cardMeta.height ?? 700;
  const maxCardWidth = 580;
  const maxCardHeight = 600;
  const scale = Math.min(maxCardWidth / cardWidth, maxCardHeight / cardHeight, 1);
  const targetWidth = Math.max(1, Math.round(cardWidth * scale));
  const targetHeight = Math.max(1, Math.round(cardHeight * scale));

  const resizedCard = await sharp(cardBuffer)
    .resize(targetWidth, targetHeight, { fit: "inside" })
    .png()
    .toBuffer();

  const background = await sharp(cardBuffer)
    .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "centre" })
    .blur(18)
    .modulate({ brightness: 0.9 })
    .toBuffer();

  const left = Math.floor((OG_WIDTH - targetWidth) / 2);
  const top = Math.floor((OG_HEIGHT - targetHeight) / 2);

  return sharp(background)
    .composite([{ input: resizedCard, left, top }])
    .png({ quality: 92, compressionLevel: 8 })
    .toBuffer();
}
