"use client";

import { useState } from "react";
import { EntryWizard } from "./EntryWizard";
import { PurchaseCapture } from "./PurchaseCapture";
import { Sheet } from "./Sheet";

type Kind = "despesa" | "venda";

const TITLE: Record<Kind, string> = { despesa: "Nova despesa", venda: "Nova venda" };

interface ControleActionsProps {
  api: string;
  today: string;
  /** Whether this deployment can read receipts with AI. */
  readerEnabled: boolean;
}

/** The two floating buttons of the "controle" home — Despesa and Vendas — and the sheet each one opens. */
export function ControleActions({ api, today, readerEnabled }: ControleActionsProps) {
  const [sheet, setSheet] = useState<Kind | null>(null);
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

      <Sheet title={sheet ? TITLE[sheet] : null} onClose={close}>
        {sheet === "despesa" ? (
          <PurchaseCapture api={api} today={today} readerEnabled={readerEnabled} onClose={close} />
        ) : (
          <EntryWizard kind="venda" api={api} today={today} onClose={close} />
        )}
      </Sheet>
    </>
  );
}
