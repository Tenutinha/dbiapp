/**
 * Logo upload rules. Raster images only: SVG can carry scripts, so it is never accepted.
 * The type is decided by the file's magic bytes, not by its name or the browser's claim.
 */
export const MAX_LOGO_BYTES = 1024 * 1024; // 1 MB

export type LogoMime = "image/png" | "image/jpeg" | "image/webp";

export const LOGO_EXT: Record<LogoMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0): boolean =>
  sig.every((b, i) => bytes[offset + i] === b);

export function detectLogoType(bytes: Uint8Array): LogoMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export type LogoCheck = { ok: true; mime: LogoMime } | { ok: false; error: string };

export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, error: "Arquivo vazio." };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, error: "O logo deve ter no máximo 1 MB." };
  const mime = detectLogoType(bytes);
  if (!mime) return { ok: false, error: "Envie o logo em PNG, JPG ou WebP." };
  return { ok: true, mime };
}
