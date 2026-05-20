import sharp from "sharp";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Skalira karticu pozivnice u standardni OG format (bez blur okvira / „modala”). */
export async function compositeCardImageToOgFormat(cardBuffer) {
  return sharp(cardBuffer)
    .resize(OG_WIDTH, OG_HEIGHT, {
      fit: "contain",
      background: { r: 255, g: 250, b: 245, alpha: 1 },
    })
    .png({ quality: 92, compressionLevel: 8 })
    .toBuffer();
}
