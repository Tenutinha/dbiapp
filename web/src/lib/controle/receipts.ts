/**
 * Proofs of purchase (photos, PDFs) kept in the client's folder:
 *
 *   orgs/<org>/clientes/<cliente>/controle/comprovantes/<aaaa-mm>/<uuid>.<jpg|png|webp|pdf>
 *
 * The database stores only the part after the client's folder, because that folder is renamed
 * when the client's address changes. Pure rules — also used by the browser.
 */

export const RECEIPT_MIME = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
} as const;

export type ReceiptExt = keyof typeof RECEIPT_MIME;
export type ReceiptMime = (typeof RECEIPT_MIME)[ReceiptExt];

/** Ceiling for a PDF. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
/** Ceiling for a photo (they are shrunk in the browser to a few hundred KB; the reader takes at most ~5 MB). */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/** Largest file accepted for a receipt of this type. */
export function maxReceiptBytes(mime: string): number {
  return mime === RECEIPT_MIME.pdf ? MAX_RECEIPT_BYTES : MAX_PHOTO_BYTES;
}

/** What the file picker offers. */
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

const FOLDER = "controle/comprovantes";
const PATH = /^controle\/comprovantes\/\d{4}-(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/;

/** The extension a receipt is stored with, from its type; null for anything not accepted. */
export function receiptExt(mime: string): ReceiptExt | null {
  const found = (Object.keys(RECEIPT_MIME) as ReceiptExt[]).find((ext) => RECEIPT_MIME[ext] === mime.toLowerCase().trim());
  return found ?? null;
}

/** A new receipt's path inside the client's folder. `month` is "aaaa-mm", `id` a UUID. */
export function receiptPath(month: string, id: string, ext: ReceiptExt): string {
  const path = `${FOLDER}/${month}/${id}.${ext}`;
  if (!PATH.test(path)) throw new Error(`invalid receipt path: ${path}`);
  return path;
}

/** Whether `path` is a receipt path this module issued (the only ones it reads, saves or deletes). */
export function isReceiptPath(path: string): boolean {
  return PATH.test(path);
}

/** The type of a stored receipt, from its path. */
export function receiptMime(path: string): ReceiptMime | null {
  if (!isReceiptPath(path)) return null;
  return RECEIPT_MIME[path.slice(path.lastIndexOf(".") + 1) as ReceiptExt];
}
