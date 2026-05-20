import sharp from "sharp";

/** Širina OG slike (portret — WhatsApp / Facebook preview). */
export const OG_MAX_WIDTH = 1200;

/** Maks. visina — izbjegava ogromne PNG/JPEG datoteke. */
export const OG_MAX_HEIGHT = 2400;

/** Meta tagovi (približan omjer nakon skaliranja). */
export const OG_META_WIDTH = OG_MAX_WIDTH;
export const OG_META_HEIGHT = OG_MAX_HEIGHT;

const JPEG_OPTIONS = {
  quality: 82,
  mozjpeg: true,
  progressive: true,
  chromaSubsampling: "4:2:0",
};

/**
 * Izreže padding, zadrži portret, JPEG (manji od PNG-a).
 */
export async function prepareInvitationOgImage(cardBuffer) {
  const trimmed = await sharp(cardBuffer)
    .trim({
      threshold: 14,
      background: { r: 255, g: 250, b: 245 },
    })
    .toBuffer();

  const { data, info } = await sharp(trimmed)
    .resize(OG_MAX_WIDTH, OG_MAX_HEIGHT, {
      fit: "inside",
      withoutEnlargement: false,
    })
    .jpeg(JPEG_OPTIONS)
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width ?? OG_MAX_WIDTH,
    height: info.height ?? OG_META_HEIGHT,
    mime: "image/jpeg",
  };
}

/** @returns {Promise<Buffer>} JPEG za OG (WhatsApp, meta tagovi). */
export async function compositeCardImageToOgFormat(cardBuffer) {
  const { buffer } = await prepareInvitationOgImage(cardBuffer);
  return buffer;
}
