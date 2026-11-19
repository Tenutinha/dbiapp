"use client";

import { useState } from "react";
import { formatValue } from "@/lib/format";
import { ledgerCards, ledgerSummary, offBy, sideOf, type LedgerCard, type LedgerSpec } from "./ledger-cards";

const money = (n: number): string => formatValue(n, "currency");
/** A balance as the books write it: its size and its side. */
const balance = (n: number): string => (n === 0 ? money(0) : `${money(Math.abs(n))} ${sideOf(n)}`);
const signed = (n: number): string => `${n > 0 ? "+" : "−"}${money(Math.abs(n))}`;

function JournalLine({ diff }: { diff: number }) {
  if (Math.abs(diff) <= 0.015) return <span className="text-ok">diário confere</span>;
  return <span className="text-danger">diário {signed(diff)}</span>;
}

function TAccount({ card }: { card: LedgerCard }) {
  return (
    <li className={`flex flex-col rounded-lg border bg-card p-3 text-xs ${card.ok ? "border-line" : "border-danger/60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-text" title={card.title}>{card.title}</p>
          {card.detail && <p className="truncate text-[11px] text-muted" title={card.detail}>{card.detail}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${card.ok ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"}`}
          title={card.ok ? "Saldo inicial + débitos − créditos = saldo final" : "A diferença que não fecha"}
        >
          {card.ok ? "✓ fecha" : `≠ ${money(offBy(card))}`}
        </span>
      </div>

      <p className="mt-2 flex justify-between tabular-nums text-muted">
        <span>Saldo inicial</span>
        <span>{balance(card.opening)}</span>
      </p>

      {/* The T: debits on the left, credits on the right. */}
      <div className="mt-1.5 grid grid-cols-2 border-t-2 border-text/70">
        <div className="border-r-2 border-text/70 py-1.5 pr-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Débito</p>
          <p className="tabular-nums font-semibold text-text">{money(card.debit)}</p>
          {card.journal && <p className="mt-0.5 text-[10px]"><JournalLine diff={card.journal.debitDiff} /></p>}
        </div>
        <div className="py-1.5 pl-2 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Crédito</p>
          <p className="tabular-nums font-semibold text-text">{money(card.credit)}</p>
          {card.journal && <p className="mt-0.5 text-[10px]"><JournalLine diff={card.journal.creditDiff} /></p>}
        </div>
      </div>

      <p className="mt-auto flex justify-between border-t border-line pt-1.5 tabular-nums font-semibold text-text">
        <span>Saldo final</span>
        <span>{balance(card.closing)}</span>
      </p>
      {Math.abs(card.balanceDiff) > 0.015 && (
        <p className="mt-1 text-[10px] text-danger">
          Esperado {balance(card.opening + card.debit - card.credit)}: o saldo final tem {signed(card.balanceDiff)}.
        </p>
      )}
    </li>
  );
}

interface LedgerProps {
  spec: LedgerSpec;
  rows: readonly Readonly<Record<string, unknown>>[];
  limit: number;
}

/**
 * Razonetes: one T account per line, each checking itself. Opens on the accounts that don't close when there
 * are any (they come first from the query); a switch shows all of them.
 */
export function Ledger({ spec, rows, limit }: LedgerProps) {
  const cards = ledgerCards(spec, rows);
  const summary = ledgerSummary(cards);
  const [all, setAll] = useState(summary.off === 0);
  const shown = all ? cards : cards.filter((c) => !c.ok);

  return (
    <div className="mt-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-muted">
          <strong className="text-text">{summary.accounts.toLocaleString("pt-BR")}</strong> conta(s) conferida(s)
          {summary.off === 0
            ? <> · <span className="font-semibold text-ok">todas fecham</span></>
            : <> · <span className="font-semibold text-danger">{summary.off.toLocaleString("pt-BR")} com diferença ({money(summary.offValue)})</span></>}
          {rows.length >= limit && <> · as {limit} primeiras: use os filtros para as demais</>}
        </p>
        {summary.off > 0 && (
          <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Quais razonetes mostrar">
            {([[false, "Com diferença"], [true, "Todas"]] as const).map(([value, label]) => (
              <button
                key={label} type="button" aria-pressed={all === value} onClick={() => setAll(value)}
                className={`rounded px-2 py-0.5 ${all === value ? "bg-brand text-on-brand" : "text-muted hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
        {shown.map((card, i) => <TAccount key={`${card.title}|${card.detail ?? ""}|${i}`} card={card} />)}
      </ul>
    </div>
  );
}
