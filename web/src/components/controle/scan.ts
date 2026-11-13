/**
 * Decisions of the live QR Code reader that do not touch the camera: how big a video frame is
 * decoded, what a code read means, and whether this browser can show the camera in the page.
 * Pure (apart from the feature check), so it is tested without a browser.
 */
import { parseNfceQr } from "@/lib/controle/nfce";

/** Longest side a frame is decoded at: a receipt's QR Code still has plenty of pixels, and jsQR keeps up. */
export const DECODE_SIDE = 800;
/** Pause between two decodings, so the phone does not heat up while the person aims. */
export const SCAN_INTERVAL_MS = 180;

/** A frame of w × h shrunk so its longest side is at most `max` (never enlarged). */
export function decodeSize(w: number, h: number, max = DECODE_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export type ScanResult =
  /** The QR Code of an NFC-e: read the note on the SEFAZ. */
  | { kind: "nfce"; qr: string }
  /** Some other QR Code (Pix, a website…): tell the person and keep looking. */
  | { kind: "other" };

/** What the codes found in one frame mean (the first NFC-e wins); null when there were none. */
export function classifyCodes(codes: readonly string[]): ScanResult | null {
  if (codes.length === 0) return null;
  const nfce = codes.find((code) => parseNfceQr(code) !== null);
  return nfce ? { kind: "nfce", qr: nfce.trim() } : { kind: "other" };
}

/** Whether the camera can be shown inside the page (needs HTTPS and getUserMedia). */
export function liveCameraSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** A friendly message for each way opening the camera fails. */
export function cameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "O acesso à câmera foi negado. Libere a câmera para este site ou use a câmera do celular.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Não encontrei uma câmera neste aparelho.";
  if (name === "NotReadableError" || name === "AbortError") return "A câmera está em uso por outro aplicativo. Feche-o e tente de novo.";
  return "Não consegui abrir a câmera aqui.";
}
