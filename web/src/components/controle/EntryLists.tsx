"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

interface PurchaseListProps {
  api: string;
  purchases: Purchase[];
  canRecord: boolean;
}

/** Purchases of the month; each one opens to show its lines and the stored proof. */
export function PurchaseList({ api, purchases, canRecord }: PurchaseListProps) {
  const [error, setError] = useState<string | null>(null);
  if (purchases.length === 0) return <Empty>Nenhuma despesa neste mês.</Empty>;

  return (
    <div className="flex flex-col gap-2">
      <ErrorNote message={error} />
      {purchases.map((p) => (
        <details key={p.id} className="card group">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
            <span className="w-11 shrink-0 text-sm tabular-nums text-muted">{dayLabel(p.purchasedOn)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.supplier ?? "Despesa"}</span>
              <span className="block text-xs text-muted">
                {p.items.length === 1 ? "1 item" : `${p.items.length} itens`}
                {p.paymentMethod ? ` · ${PAYMENT_LABEL[p.paymentMethod]}` : ""}
                {p.hasReceipt ? " · com comprovante" : ""}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{formatMoney(p.totalCents)}</span>
            <span aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-90">›</span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-line p-4">
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
            <div className="flex items-center justify-between gap-3">
              {p.hasReceipt ? (
                <a href={`${api}/comprovante/${p.id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand underline-offset-2 hover:underline">
                  Abrir comprovante
                </a>
              ) : (
                <span className="text-xs text-muted">Lançada à mão</span>
              )}
              {canRecord && (
                <RemoveButton
                  api={api}
                  action="purchaseRemove"
                  id={p.id}
                  what={`a despesa de ${formatMoney(p.totalCents)}${p.supplier ? ` em ${p.supplier}` : ""}`}
                  onError={setError}
                />
              )}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

interface SaleListProps {
  api: string;
  sales: Sale[];
  canRecord: boolean;
}

export function SaleList({ api, sales, canRecord }: SaleListProps) {
  const [error, setError] = useState<string | null>(null);
  if (sales.length === 0) return <Empty>Nenhuma venda neste mês.</Empty>;

  return (
    <div className="flex flex-col gap-2">
      <ErrorNote message={error} />
      <ul className="card divide-y divide-line">
        {sales.map((s) => (
          <li key={s.id} className="flex items-center gap-3 p-4">
            <span className="w-11 shrink-0 text-sm tabular-nums text-muted">{dayLabel(s.soldOn)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{s.customerName ?? s.product ?? "Venda"}</span>
              <span className="block text-xs text-muted">
                {[s.paymentMethod ? PAYMENT_LABEL[s.paymentMethod] : null, s.customerName ? s.product : null].filter(Boolean).join(" · ") || "Pagamento não informado"}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="font-semibold tabular-nums">{formatMoney(s.totalCents)}</span>
              {canRecord && (
                <RemoveButton api={api} action="saleRemove" id={s.id} what={`a venda de ${formatMoney(s.totalCents)}${s.customerName ? ` para ${s.customerName}` : ""}`} onError={setError} />
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
