"use client";

import { useEffect, useRef, useState } from "react";
import { PurchaseCapture } from "./PurchaseCapture";
import { SaleWizard } from "./SaleWizard";

type Sheet = "despesa" | "venda";

const TITLE: Record<Sheet, string> = { despesa: "Nova despesa", venda: "Nova venda" };

interface ControleActionsProps {
  api: string;
  today: string;
  /** Whether this deployment can read receipts with AI. */
  readerEnabled: boolean;
}

/**
 * The two floating buttons of the "controle" home — Despesa and Vendas — and the sheet each one opens
 * (from the bottom on a phone, centred on a larger screen). The form only exists while its sheet is open,
 * so every opening starts clean.
 */
export function ControleActions({ api, today, readerEnabled }: ControleActionsProps) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (sheet && !dialog.open) dialog.showModal();
    if (!sheet && dialog.open) dialog.close();
  }, [sheet]);

  const close = (): void => setSheet(null);

  return (
    <>
      {/* Centred on the content: on large screens the standard sidebar takes the first 300 px. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:left-[300px]">
        <div className="pointer-events-auto flex w-full max-w-sm gap-2 rounded-full border border-line bg-card/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur">
          <button type="button" onClick={() => setSheet("despesa")} className="flex-1 rounded-full border border-line py-3 text-base font-semibold transition hover:bg-text/5">
            <span aria-hidden className="mr-1 text-danger">−</span>Despesa
          </button>
          <button type="button" onClick={() => setSheet("venda")} className="flex-1 rounded-full bg-brand py-3 text-base font-semibold text-on-brand">
            <span aria-hidden className="mr-1">+</span>Vendas
          </button>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        onClose={close}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        aria-label={sheet ? TITLE[sheet] : undefined}
        className="mx-auto mb-0 mt-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-card p-0 text-text backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:my-auto sm:rounded-2xl"
      >
        {sheet && (
          <div className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-2">{TITLE[sheet]}</h2>
              <button type="button" onClick={close} aria-label="Fechar" className="grid size-10 place-items-center rounded-lg text-xl text-muted hover:bg-text/5">✕</button>
            </div>
            {sheet === "despesa" ? (
              <PurchaseCapture api={api} today={today} readerEnabled={readerEnabled} />
            ) : (
              <SaleWizard api={api} today={today} onClose={close} />
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
