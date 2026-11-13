"use client";

import { useEffect, useRef, useState } from "react";
import { cameraError, classifyCodes, decodeSize, SCAN_INTERVAL_MS } from "./scan";

/** The browser's own barcode reader (Chrome on Android); not in TypeScript's DOM types yet. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorClass = new (options: { formats: string[] }) => BarcodeDetectorLike;

interface QrScannerProps {
  /** An NFC-e QR Code was seen: what it says and the frame it was in (kept as the receipt photo). */
  onNfce: (qr: string, photo: File) => void;
  /** "Tirar foto": the current frame, read like any photo of a receipt. */
  onPhoto: (photo: File) => void;
  /** The camera could not open here: the phone's own camera app instead (called inside a tap). */
  onNativeCamera: () => void;
  onCancel: () => void;
}

/** One decoder for the whole scan: the browser's when it reads QR Codes, else jsQR (iPhones). */
async function makeDecoder(): Promise<(frame: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Promise<string[]>> {
  const Native = (globalThis as { BarcodeDetector?: BarcodeDetectorClass & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  const formats: string[] = Native?.getSupportedFormats ? await Native.getSupportedFormats().catch(() => []) : [];
  if (Native && formats.includes("qr_code")) {
    const detector = new Native({ formats: ["qr_code"] });
    return async (frame) => (await detector.detect(frame)).map((c) => c.rawValue);
  }
  const { default: jsQR } = await import("jsqr");
  return async (frame, ctx) => {
    const { data } = ctx.getImageData(0, 0, frame.width, frame.height);
    const found = jsQR(data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
    return found?.data ? [found.data] : [];
  };
}

/** The current video frame at full size, as a JPEG file (the receipt photo). */
async function snapshot(video: HTMLVideoElement): Promise<File | null> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0) return null;
  ctx.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  return blob ? new File([blob], `comprovante-${Date.now()}.jpg`, { type: "image/jpeg" }) : null;
}

/**
 * The camera inside the page, looking for the QR Code of an NFC-e while the person aims: as soon as
 * one shows up the note goes to the SEFAZ, with no photo to take. Receipts without a QR Code use
 * "Tirar foto". If the camera cannot open (denied, none, in use), the phone's camera app is offered.
 */
export function QrScanner({ onNfce, onPhoto, onNativeCamera, onCancel }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const doneRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const handlers = useRef({ onNfce, onPhoto });
  useEffect(() => {
    handlers.current = { onNfce, onPhoto };
  }, [onNfce, onPhoto]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const frame = document.createElement("canvas");
    const ctx = frame.getContext("2d", { willReadFrequently: true });

    async function start(): Promise<void> {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (err) {
        console.error("[controle] camera did not open", err);
        if (!stopped) setFailure(cameraError(err));
        return;
      }
      const video = videoRef.current;
      if (stopped || !video || !ctx) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined); // muted + playsInline: allowed without a tap
      setReady(true);
      const decode = await makeDecoder();

      const tick = async (): Promise<void> => {
        if (stopped || doneRef.current) return;
        if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          const size = decodeSize(video.videoWidth, video.videoHeight);
          frame.width = size.width;
          frame.height = size.height;
          ctx.drawImage(video, 0, 0, size.width, size.height);
          const result = classifyCodes(await decode(frame, ctx).catch(() => []));
          if (result?.kind === "nfce" && !doneRef.current && !stopped) {
            doneRef.current = true;
            navigator.vibrate?.(80);
            const photo = await snapshot(video);
            if (photo) {
              handlers.current.onNfce(result.qr, photo);
              return;
            }
            doneRef.current = false;
          }
          setHint(result?.kind === "other" ? "Este QR Code não é de uma NFC-e. Aponte para o QR Code da nota." : null);
        }
        timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      };
      void tick();
    }

    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function takePhoto(): Promise<void> {
    const video = videoRef.current;
    if (!video || doneRef.current) return;
    doneRef.current = true;
    const photo = await snapshot(video);
    if (photo) handlers.current.onPhoto(photo);
    else doneRef.current = false;
  }

  if (failure) {
    return (
      <div className="flex flex-col gap-3 text-center">
        <p role="alert" className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{failure}</p>
        <button type="button" onClick={onNativeCamera} className="btn btn-primary justify-center py-3">Usar a câmera do celular</button>
        <button type="button" onClick={onCancel} className="btn btn-ghost justify-center">Voltar</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} muted playsInline autoPlay aria-label="Imagem da câmera" className="aspect-[3/4] w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <div className="size-[62%] rounded-2xl border-[3px] border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        {!ready && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-white/80">Abrindo a câmera…</p>}
      </div>
      <p role="status" aria-live="polite" className="text-center text-sm">
        {hint ?? "Aponte para o QR Code da nota. A leitura é automática."}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost justify-center">Cancelar</button>
        <button type="button" onClick={() => void takePhoto()} disabled={!ready} className="btn btn-primary justify-center">Tirar foto</button>
      </div>
      <p className="text-center text-xs text-muted">Cupom sem QR Code? Use &ldquo;Tirar foto&rdquo; e a leitura é feita pela foto.</p>
    </div>
  );
}
