"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/controle/money";
import { parseNfceQr } from "@/lib/controle/nfce";
import { RECEIPT_ACCEPT } from "@/lib/controle/receipts";
import type { PurchaseDraft } from "@/lib/controle/schema";
import type { NfceImport } from "@/lib/services/controle";
import { call, ControleError, sendReceipt, type SentReceipt } from "./api";
import { EntryWizard } from "./EntryWizard";
import { ErrorNote } from "./fields";
import { shrinkPhoto } from "./image";
import { PurchaseForm } from "./PurchaseForm";
import { readQrCode } from "./qr";

const EMPTY: PurchaseDraft = { readable: true, supplier: null, purchasedOn: null, totalCents: null, paymentMethod: null, notes: null, items: [] };
const NOTE_ALREADY_IN = "Esta nota já foi lançada.";

interface Review {
  draft: PurchaseDraft;
  receipt: SentReceipt | null;
  fromReceipt: boolean;
  /** Object URL of the photo, to compare while checking (not for PDFs). */
  preview: string | null;
  /** Why the person is typing instead of checking (the reader failed or found nothing). */
  notice: string | null;
  /** The NFC-e whose QR Code was in the photo, saved with the expense. */
  nfceKey: string | null;
}

type Stage =
  | { name: "idle" }
  | { name: "manual" }
  | { name: "working"; step: string }
  | ({ name: "review" } & Review)
  /** An NFC-e read on the SEFAZ and already saved; "conferir" opens it for editing. */
  | { name: "nfceSaved"; id: string; draft: PurchaseDraft; editing: boolean };

interface PurchaseCaptureProps {
  api: string;
  today: string;
  /** Whether this deployment can read receipts with AI; without it the receipt is only kept. */
  readerEnabled: boolean;
  /** Closes the sheet this lives in. */
  onClose: () => void;
}

const message = (err: unknown): string => (err instanceof ControleError ? err.message : "Algo deu errado. Tente de novo.");
const items = (n: number): string => (n === 1 ? "1 item" : `${n} itens`);

/**
 * New purchase, from the phone: photograph the receipt (or pick a file). When the photo shows the
 * QR Code of an NFC-e, the note is read on the SEFAZ and saved right away; otherwise the photo is
 * read by the AI and checked before saving. Without a proof, "Lançar à mão" asks one question at a time.
 */
export function PurchaseCapture({ api, today, readerEnabled, onClose }: PurchaseCaptureProps) {
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

  const discard = (receipt: SentReceipt): void => {
    void call(api, { action: "receiptDiscard", path: receipt.path }).catch(() => undefined); // best effort: an orphan file is harmless
  };

  /** The QR Code of an NFC-e: read on the SEFAZ. Returns what the photo reading should still say, or null when it is handled. */
  async function tryNfce(qr: string, receipt: SentReceipt, base: Pick<Review, "receipt" | "preview">): Promise<{ notice: string; key: string | null } | null> {
    try {
      setStage({ name: "working", step: "Consultando a nota na SEFAZ…" });
      const result = await call<NfceImport>(`${api}/nfce`, { qr, receipt });
      if (result.saved) {
        setStage({ name: "nfceSaved", id: result.id, draft: result.draft, editing: false });
        router.refresh();
        return null;
      }
      if (result.draft.readable) {
        setStage({ name: "review", ...base, draft: result.draft, fromReceipt: true, nfceKey: result.key, notice: result.notice });
        return null;
      }
      return { notice: `${result.notice} Li pela foto.`, key: result.key };
    } catch (err) {
      if (message(err) === NOTE_ALREADY_IN) {
        discard(receipt);
        setError(NOTE_ALREADY_IN);
        setStage({ name: "idle" });
        return null;
      }
      return { notice: `${message(err)} Li pela foto.`, key: parseNfceQr(qr)?.key ?? null };
    }
  }

  async function handleFile(picked: File | undefined): Promise<void> {
    if (!picked) return;
    setError(null);
    setSaved(false);
    let receipt: SentReceipt;
    let file: File;
    let qr: string | null = null;
    try {
      setStage({ name: "working", step: "Preparando a foto…" });
      // The QR Code is looked for on the full picture, before it is shrunk for sending.
      const found = readerEnabled ? await readQrCode(picked) : null;
      qr = found && parseNfceQr(found) ? found : null;
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
      setStage({ name: "review", ...base, draft: EMPTY, fromReceipt: false, nfceKey: null, notice: "Comprovante guardado. Preencha os dados da despesa." });
      return;
    }
    let fallback: { notice: string; key: string | null } | null = null;
    if (qr) {
      fallback = await tryNfce(qr, receipt, base);
      if (!fallback) return;
    }
    try {
      setStage({ name: "working", step: "Lendo o comprovante…" });
      const draft = await call<PurchaseDraft>(api, { action: "receiptRead", path: receipt.path });
      const unreadable = !draft.readable || (draft.items.length === 0 && draft.totalCents === null);
      const failed = unreadable ? `Não consegui ler este comprovante${draft.notes ? ` (${draft.notes})` : ""}. Ele fica guardado; preencha os dados.` : null;
      setStage({
        name: "review",
        ...base,
        draft,
        fromReceipt: !unreadable,
        nfceKey: fallback?.key ?? null,
        notice: [fallback?.notice, failed].filter(Boolean).join(" ") || null,
      });
    } catch (err) {
      // The receipt is already stored: the purchase can still be typed with it attached.
      setStage({ name: "review", ...base, draft: EMPTY, fromReceipt: false, nfceKey: fallback?.key ?? null, notice: `${message(err)} O comprovante fica guardado.` });
    }
  }

  function cancel(): void {
    if (stage.name === "review" && stage.receipt) discard(stage.receipt);
    setStage({ name: "idle" });
  }

  function done(): void {
    setStage({ name: "idle" });
    setSaved(true);
    router.refresh();
  }

  if (stage.name === "manual") {
    return <EntryWizard kind="despesa" api={api} today={today} onClose={onClose} onBack={() => setStage({ name: "idle" })} />;
  }

  if (stage.name === "working") {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center" role="status" aria-live="polite">
        <span className="size-8 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />
        <p className="font-semibold">{stage.step}</p>
        <p className="text-xs text-muted">Leva alguns segundos. Não feche esta tela.</p>
      </div>
    );
  }

  if (stage.name === "nfceSaved") {
    const { draft } = stage;
    if (stage.editing) {
      return (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">Conferir a nota</h2>
          <PurchaseForm api={api} today={today} draft={draft} receipt={null} fromReceipt editId={stage.id} onSaved={done} onCancel={done} />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
        <span className="grid size-14 place-items-center rounded-full bg-ok/15 text-2xl text-ok" aria-hidden>✓</span>
        <p className="text-xl font-bold leading-tight">Despesa de {formatMoney(draft.totalCents ?? 0)} lançada</p>
        <p className="text-sm text-muted">
          {draft.supplier} · {items(draft.items.length)} · lida na SEFAZ pelo QR Code
        </p>
        <div className="mt-2 grid w-full grid-cols-2 gap-2">
          <button type="button" onClick={() => setStage({ ...stage, editing: true })} className="btn btn-ghost justify-center py-3">Conferir itens</button>
          <button type="button" onClick={() => { setStage({ name: "idle" }); router.refresh(); }} className="btn btn-primary justify-center py-3">Lançar outra</button>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-muted underline underline-offset-4">Fechar</button>
      </div>
    );
  }

  if (stage.name === "review") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold">{stage.fromReceipt ? "Confira a despesa" : "Dados da despesa"}</h2>
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
          nfceKey={stage.nfceKey}
          onSaved={done}
          onCancel={cancel}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} hidden onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }} />
      <button type="button" onClick={() => cameraRef.current?.click()} className="btn btn-primary flex-col justify-center gap-0.5 py-3.5 text-base">
        Fotografar cupom ou QR Code
        {readerEnabled && <span className="text-xs font-normal opacity-80">NFC-e com QR Code: os dados vêm direto da SEFAZ</span>}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-ghost justify-center">Foto ou PDF</button>
        <button
          type="button"
          onClick={() => { setError(null); setSaved(false); setStage({ name: "manual" }); }}
          className="btn btn-ghost justify-center"
        >
          Lançar à mão
        </button>
      </div>
      {saved && <p role="status" className="text-center text-sm text-ok">Despesa salva.</p>}
      <ErrorNote message={error} />
    </div>
  );
}
