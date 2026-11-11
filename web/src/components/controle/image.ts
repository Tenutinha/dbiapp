/** Longest side a receipt photo is sent with: enough to read small print, a fraction of a camera file. */
const MAX_SIDE = 2000;
const QUALITY = 0.85;

/**
 * Shrinks a phone photo before sending (a 12 MP picture is 4–8 MB; this makes it a few hundred KB)
 * and turns whatever the browser can decode (HEIC on iPhones, PNG screenshots) into JPEG.
 * PDFs, and photos the browser cannot decode, go as they are — the server decides if they are accepted.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; // transparent PNGs would turn black in JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
