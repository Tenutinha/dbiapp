"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Entry } from "@/lib/controle/entries";
import { formatMoney, formatQuantity } from "@/lib/controle/money";
import { dayLabel, PAYMENT_LABEL, type Purchase, type Sale } from "@/lib/controle/schema";
import { call, ControleError } from "./api";
import { ErrorNote } from "./fields";

interface RemoveButtonProps {
  api: string;
  action: "purchaseRemove" | "saleRemove";
  id: string;
  /** What the confirmation names: "a despesa de R$ 57,48 em Atacadão". */
  what: string;
  onError: (message: string | null) => void;
}

function RemoveButton({ api, action, id, what, onError }: RemoveButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(): Promise<void> {
    if (!window.confirm(`Excluir ${what}? Não dá para desfazer.`)) return;
    setBusy(true);
    onError(null);
    try {
      await call(api, { action, id });
      router.refresh();
    } catch (err) {
      onError(err instanceof ControleError ? err.message : "Não foi possível excluir.");
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={remove} disabled={busy} className="text-sm text-danger underline-offset-2 hover:underline disabled:opacity-50">
      {busy ? "Excluindo…" : "Excluir"}
    </button>
  );
}

/** What kind of entry a row is: an arrow going out (despesa) or coming in (venda), also named for screen readers. */
function KindIcon({ kind }: { kind: Entry["kind"] }) {
  const sale = kind === "venda";
  return (
    <span
      role="img"
      aria-label={sale ? "Venda" : "Despesa"}
      title={sale ? "Venda" : "Despesa"}
      className={`grid size-9 shrink-0 place-items-center rounded-full ${sale ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {sale ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
      </svg>
    </span>
  );
}

const purchaseTitle = (p: Purchase): string => p.supplier ?? "Despesa";
const saleTitle = (s: Sale): string => s.customerName ?? s.product ?? "Venda";

function purchaseDetail(p: Purchase): string {
  return [
    p.items.length === 1 ? "1 item" : p.items.length > 1 ? `${p.items.length} itens` : null,
    p.paymentMethod ? PAYMENT_LABEL[p.paymentMethod] : null,
    p.hasReceipt ? "com comprovante" : null,
  ].filter(Boolean).join(" · ") || "Despesa";
}

function saleDetail(s: Sale): string {
  return [s.paymentMethod ? PAYMENT_LABEL[s.paymentMethod] : null, s.customerName ? s.product : null].filter(Boolean).join(" · ") || "Pagamento não informado";
}

interface PurchaseBodyProps {
  api: string;
  purchase: Purchase;
}

function PurchaseBody({ api, purchase: p }: PurchaseBodyProps) {
  return (
    <>
      {p.items.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {p.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                {item.description}
                <span className="text-muted"> · {formatQuantity(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatMoney(item.totalCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {p.notes && <p className="text-sm text-muted">{p.notes}</p>}
      {p.hasReceipt && (
        <a href={`${api}/comprovante/${p.id}`} target="_blank" rel="noreferrer" className="self-start text-sm font-semibold text-brand underline-offset-2 hover:underline">
          Abrir comprovante
        </a>
      )}
    </>
  );
}

interface EntryListProps {
  api: string;
  /** Purchases and sales of the month, already in display order (see mergeEntries). */
  entries: Entry[];
  canRecord: boolean;
}

/** Everything recorded in the month in one list; the icon tells a despesa from a venda. Each row opens for its details. */
export function EntryList({ api, entries, canRecord }: EntryListProps) {
  const [error, setError] = useState<string | null>(null);
  if (entries.length === 0) {
    return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">Nenhum lançamento neste mês.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <ErrorNote message={error} />
      {entries.map((entry) => {
        const sale = entry.kind === "venda";
        const title = sale ? saleTitle(entry.sale) : purchaseTitle(entry.purchase);
        return (
          <details key={`${entry.kind}-${entry.id}`} className="card group">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
              <KindIcon kind={entry.kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{title}</span>
                <span className="block truncate text-xs text-muted">
                  {dayLabel(entry.day)} · {sale ? saleDetail(entry.sale) : purchaseDetail(entry.purchase)}
                </span>
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${sale ? "text-ok" : ""}`}>
                {sale ? "+" : "−"} {formatMoney(entry.totalCents)}
              </span>
              <span aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="flex flex-col gap-3 border-t border-line p-4">
              {!sale && <PurchaseBody api={api} purchase={entry.purchase} />}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted">
                  {sale ? "Venda" : entry.purchase.hasReceipt ? "Despesa" : "Despesa lançada à mão"} de {dayLabel(entry.day)}
                </span>
                {canRecord && (
                  <RemoveButton
                    api={api}
                    action={sale ? "saleRemove" : "purchaseRemove"}
                    id={entry.id}
                    what={
                      sale
                        ? `a venda de ${formatMoney(entry.totalCents)}${entry.sale.customerName ? ` para ${entry.sale.customerName}` : ""}`
                        : `a despesa de ${formatMoney(entry.totalCents)}${entry.purchase.supplier ? ` em ${entry.purchase.supplier}` : ""}`
                    }
                    onError={setError}
                  />
                )}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
