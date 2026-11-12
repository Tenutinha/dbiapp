/**
 * Finds a QR Code in a photo, in the browser (iPhones have no native barcode reader for pages).
 * The decoder is loaded only when a photo is read. Tries the whole picture and then its lower half
 * and lower third (where the NFC-e QR Code usually is, so it comes out bigger); null when none is found.
 * Each try shrinks to 1200 px with smoothing: averaging the pixels away is what lets a QR Code that
 * fills a tenth of a 12 MP photo be read in a fraction of a second.
 */
const SIDE = 1200;

async function attempt(
  jsQR: typeof import("jsqr").default,
  bitmap: ImageBitmap,
  crop: { x: number; y: number; w: number; h: number },
): Promise<string | null> {
  const scale = Math.min(1, SIDE / Math.max(crop.w, crop.h));
  const width = Math.max(1, Math.round(crop.w * scale));
  const height = Math.max(1, Math.round(crop.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

export async function readQrCode(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const { default: jsQR } = await import("jsqr");
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const { width: w, height: h } = bitmap;
      const crops = [
        { x: 0, y: 0, w, h },
        { x: 0, y: Math.round(h / 2), w, h: Math.round(h / 2) },
        { x: 0, y: Math.round((h * 2) / 3), w, h: Math.round(h / 3) },
      ];
      for (const crop of crops) {
        const found = await attempt(jsQR, bitmap, crop);
        if (found) return found;
      }
      return null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null; // an undecodable photo is just "no QR Code": the photo is still read by the AI
  }
}
