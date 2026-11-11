"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RECEIPT_ACCEPT } from "@/lib/controle/receipts";
import type { PurchaseDraft } from "@/lib/controle/schema";
import { call, ControleError, sendReceipt, type SentReceipt } from "./api";
import { ErrorNote } from "./fields";
import { shrinkPhoto } from "./image";
import { PurchaseForm } from "./PurchaseForm";

const EMPTY: PurchaseDraft = { readable: true, supplier: null, purchasedOn: null, totalCents: null, paymentMethod: null, notes: null, items: [] };

interface Review {
  draft: PurchaseDraft;
  receipt: SentReceipt | null;
  fromReceipt: boolean;
  /** Object URL of the photo, to compare while checking (not for PDFs). */
  preview: string | null;
  /** Why the person is typing instead of checking (the reader failed or found nothing). */
  notice: string | null;
}

type Stage = { name: "idle" } | { name: "working"; step: string } | ({ name: "review" } & Review);

interface PurchaseCaptureProps {
  api: string;
  today: string;
  /** Whether this deployment can read receipts with AI; without it the receipt is only kept. */
  readerEnabled: boolean;
}

const message = (err: unknown): string => (err instanceof ControleError ? err.message : "Algo deu errado. Tente de novo.");

/**
 * New purchase, from the phone: photograph (or pick) the proof, wait while it is stored and read,
 * check the result, save. Typing everything by hand is always one tap away.
 */
export function PurchaseCapture({ api, today, readerEnabled }: PurchaseCaptureProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = stage.name === "review" ? stage.preview : null;

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function handleFile(picked: File | undefined): Promise<void> {
    if (!picked) return;
    setError(null);
    setSaved(false);
    let receipt: SentReceipt;
    let file: File;
    try {
      setStage({ name: "working", step: "Preparando a foto…" });
      file = await shrinkPhoto(picked);
      setStage({ name: "working", step: "Enviando o comprovante…" });
      receipt = await sendReceipt(api, file);
    } catch (err) {
      setError(message(err));
      setStage({ name: "idle" });
      return;
    }

    const base = { receipt, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null };
    if (!readerEnabled) {
      setStage({ name: "review", ...base, draft: EMPTY, fromReceipt: false, notice: "Comprovante guardado. Preencha os dados da compra." });
      return;
    }
    try {
      setStage({ name: "working", step: "Lendo o comprovante…" });
      const draft = await call<PurchaseDraft>(api, { action: "receiptRead", path: receipt.path });
      const unreadable = !draft.readable || (draft.items.length === 0 && draft.totalCents === null);
      setStage({
        name: "review",
        ...base,
        draft,
        fromReceipt: !unreadable,
        notice: unreadable ? `Não consegui ler este comprovante${draft.notes ? ` (${draft.notes})` : ""}. Ele fica guardado; preencha os dados.` : null,
      });
    } catch (err) {
      // The receipt is already stored: the purchase can still be typed with it attached.
      setStage({ name: "review", ...base, draft: EMPTY, fromReceipt: false, notice: `${message(err)} O comprovante fica guardado.` });
    }
  }

  function cancel(): void {
    if (stage.name === "review" && stage.receipt) {
      void call(api, { action: "receiptDiscard", path: stage.receipt.path }).catch(() => undefined); // best effort: an orphan file is harmless
    }
    setStage({ name: "idle" });
  }

  function done(): void {
    setStage({ name: "idle" });
    setSaved(true);
    router.refresh();
  }

  if (stage.name === "working") {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center" role="status" aria-live="polite">
        <span className="size-8 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />
        <p className="font-semibold">{stage.step}</p>
        <p className="text-xs text-muted">Leva alguns segundos. Não feche esta tela.</p>
      </div>
    );
  }

  if (stage.name === "review") {
    return (
      <div className="card flex flex-col gap-4 p-4">
        <div>
          <h2 className="text-lg font-bold">{stage.fromReceipt ? "Confira a compra" : "Nova compra"}</h2>
          {stage.fromReceipt && <p className="text-sm text-muted">Li o comprovante. Corrija o que estiver errado antes de salvar.</p>}
          {stage.notice && <p className="mt-1 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{stage.notice}</p>}
        </div>
        {stage.preview && (
          <details className="rounded-xl border border-line">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Ver a foto do comprovante</summary>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an asset */}
            <img src={stage.preview} alt="Comprovante enviado" className="max-h-[70vh] w-full rounded-b-xl object-contain" />
          </details>
        )}
        <PurchaseForm
          key={stage.receipt?.path ?? "manual"}
          api={api}
          today={today}
          draft={stage.draft}
          receipt={stage.receipt}
          fromReceipt={stage.fromReceipt}
          onSaved={done}
          onCancel={cancel}
        />
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} hidden onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }} />
      <button type="button" onClick={() => cameraRef.current?.click()} className="btn btn-primary justify-center py-4 text-base">
        Fotografar comprovante
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-ghost justify-center">Foto ou PDF</button>
        <button
          type="button"
          onClick={() => { setError(null); setSaved(false); setStage({ name: "review", draft: EMPTY, receipt: null, fromReceipt: false, preview: null, notice: null }); }}
          className="btn btn-ghost justify-center"
        >
          Lançar à mão
        </button>
      </div>
      {saved && <p role="status" className="text-center text-sm text-ok">Compra salva.</p>}
      <ErrorNote message={error} />
    </div>
  );
}
