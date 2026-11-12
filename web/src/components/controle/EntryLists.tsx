"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/admin/Avatar";
import type { Entry } from "@/lib/controle/entries";
import { formatMoney, formatQuantity } from "@/lib/controle/money";
import { dayLabel, PAYMENT_LABEL, type Purchase, type Sale } from "@/lib/controle/schema";
import { STATUS_LABEL, type EntryStatus } from "@/lib/controle/status";
import { call, ControleError } from "./api";
import { ErrorNote } from "./fields";
import { PurchaseForm } from "./PurchaseForm";
import { SaleEditForm } from "./SaleEditForm";
import { Sheet } from "./Sheet";

/** Square icon button of a row; it sits in the row's summary, so its tap must not open or close the row. */
const ROW_BUTTON = "grid size-9 shrink-0 place-items-center rounded-lg text-muted transition";

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

  async function remove(e: React.MouseEvent): Promise<void> {
    e.preventDefault(); // it sits in the row's summary: the tap must not open or close the row
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
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      aria-label={`Excluir ${what}`}
      title="Excluir"
      className={`${ROW_BUTTON} hover:bg-danger/10 hover:text-danger disabled:animate-pulse disabled:opacity-50`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
      </svg>
    </button>
  );
}

interface StatusToggleProps {
  api: string;
  entry: Entry;
  status: EntryStatus;
  /** "icon": the ✓ of a pending row; "text": the link inside an opened row. */
  look: "icon" | "text";
  onError: (message: string | null) => void;
}

/** Confirms a pending entry (the money moved) or puts a confirmed one back as pending. */
function StatusToggle({ api, entry, status, look, onError }: StatusToggleProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next: EntryStatus = status === "pendente" ? "efetivado" : "pendente";
  const label = `Marcar como ${STATUS_LABEL[entry.kind][next].toLowerCase()}`;

  async function change(e: React.MouseEvent): Promise<void> {
    e.preventDefault(); // the icon sits in the row's summary: the tap must not open or close the row
    setBusy(true);
    onError(null);
    try {
      await call(api, { action: "statusSet", kind: entry.kind, id: entry.id, status: next });
      router.refresh();
    } catch (err) {
      onError(err instanceof ControleError ? err.message : "Não foi possível mudar a situação.");
    } finally {
      setBusy(false);
    }
  }

  if (look === "text") {
    return (
      <button type="button" onClick={change} disabled={busy} className="self-start text-sm font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-50">
        {busy ? "Salvando…" : label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={change}
      disabled={busy}
      aria-label={`${label}: ${describe(entry)}`}
      title={label}
      className={`${ROW_BUTTON} text-ok hover:bg-ok/10 disabled:animate-pulse disabled:opacity-50`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </button>
  );
}

function EditButton({ what, onEdit }: { what: string; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); onEdit(); }}
      aria-label={`Editar ${what}`}
      title="Editar"
      className={`${ROW_BUTTON} hover:bg-brand/10 hover:text-brand`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  );
}

/** What the confirmation and the buttons name: "a despesa de R$ 57,48 em Atacadão". */
function describe(entry: Entry): string {
  const amount = formatMoney(entry.totalCents);
  if (entry.kind === "venda") return `a receita de ${amount}${entry.sale.customerName ? ` para ${entry.sale.customerName}` : ""}`;
  return `a despesa de ${amount}${entry.purchase.supplier ? ` em ${entry.purchase.supplier}` : ""}`;
}

/**
 * What kind of entry a row is: an arrow going out (despesa) or coming in (venda), also named for
 * screen readers. A dashed outline marks the ones still pending.
 */
function KindIcon({ kind, pending }: { kind: Entry["kind"]; pending: boolean }) {
  const sale = kind === "venda";
  const name = `${sale ? "Receita" : "Despesa"}${pending ? ` (${STATUS_LABEL[kind].pendente.toLowerCase()})` : ""}`;
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={`grid size-9 shrink-0 place-items-center rounded-full ${sale ? "bg-ok/15 text-ok" : "bg-danger/15 text-danger"} ${
        pending ? "outline-2 outline-offset-2 outline-dashed outline-accent" : ""
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {sale ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
      </svg>
    </span>
  );
}

const purchaseTitle = (p: Purchase): string => p.supplier ?? "Despesa";
const saleTitle = (s: Sale): string => s.customerName ?? s.product ?? "Receita";

function purchaseDetail(p: Purchase): string {
  return [
    p.items.length === 1 ? "1 item" : p.items.length > 1 ? `${p.items.length} itens` : null,
    p.paymentMethod ? PAYMENT_LABEL[p.paymentMethod] : null,
    p.nfceKey ? "NFC-e" : p.hasReceipt ? "com comprovante" : null,
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
  today: string;
  /** Purchases and sales of the month, already in display order (see mergeEntries). */
  entries: Entry[];
  canRecord: boolean;
}

/** Everything recorded in the month in one list; the icon tells a despesa from a venda. Each row opens for its details. */
export function EntryList({ api, today, entries, canRecord }: EntryListProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const stopEditing = (): void => setEditing(null);
  const edited = (): void => {
    setEditing(null);
    router.refresh();
  };
  if (entries.length === 0) {
    return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">Nenhum lançamento neste mês.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <ErrorNote message={error} />
      {/* Its own scroll: a long month does not push the rest of the screen away. */}
      <div className="-mr-1 flex max-h-[60dvh] flex-col gap-2 overflow-y-auto pr-1">
      {entries.map((entry) => {
        const sale = entry.kind === "venda";
        const title = sale ? saleTitle(entry.sale) : purchaseTitle(entry.purchase);
        const author = sale ? entry.sale.author : entry.purchase.author;
        const status = sale ? entry.sale.status : entry.purchase.status;
        const pending = status === "pendente";
        return (
          <details key={`${entry.kind}-${entry.id}`} className="card group shrink-0">
            <summary className="flex cursor-pointer list-none items-center gap-2 p-3 sm:gap-3 sm:p-4 [&::-webkit-details-marker]:hidden">
              <KindIcon kind={entry.kind} pending={pending} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{title}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  {author && <Avatar name={author.name} email="" imageUrl={author.avatarUrl} size="xs" title={`Lançado por ${author.name}`} className="ring-1" />}
                  <span className="truncate">
                    {pending && <span className="font-semibold text-accent">{STATUS_LABEL[entry.kind].pendente} · </span>}
                    {dayLabel(entry.day)} · {sale ? saleDetail(entry.sale) : purchaseDetail(entry.purchase)}</span>
                </span>
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${sale ? "text-ok" : ""} ${pending ? "opacity-60" : ""}`}>
                {sale ? "+" : "−"} {formatMoney(entry.totalCents)}
              </span>
              {canRecord && (
                <span className="flex shrink-0">
                  {pending && <StatusToggle api={api} entry={entry} status={status} look="icon" onError={setError} />}
                  <EditButton what={describe(entry)} onEdit={() => { setError(null); setEditing(entry); }} />
                  <RemoveButton api={api} action={sale ? "saleRemove" : "purchaseRemove"} id={entry.id} what={describe(entry)} onError={setError} />
                </span>
              )}
              <span aria-hidden className="hidden shrink-0 text-muted transition-transform group-open:rotate-90 sm:block">›</span>
            </summary>
            <div className="flex flex-col gap-3 border-t border-line p-4">
              {!sale && <PurchaseBody api={api} purchase={entry.purchase} />}
              <span className="text-xs text-muted">
                {sale ? "Receita" : entry.purchase.hasReceipt ? "Despesa" : "Despesa lançada à mão"} de {dayLabel(entry.day)}
                {author ? ` · lançado por ${author.name}` : ""}
                {` · ${STATUS_LABEL[entry.kind][status].toLowerCase()}`}
              </span>
              {canRecord && <StatusToggle api={api} entry={entry} status={status} look="text" onError={setError} />}
            </div>
          </details>
        );
      })}
      </div>
      <Sheet title={editing ? (editing.kind === "venda" ? "Editar receita" : "Editar despesa") : null} onClose={stopEditing}>
        {editing?.kind === "venda" && <SaleEditForm api={api} sale={editing.sale} onSaved={edited} onCancel={stopEditing} />}
        {editing?.kind === "despesa" && (
          <PurchaseForm
            api={api}
            today={today}
            draft={{ ...editing.purchase, readable: true }}
            receipt={null}
            fromReceipt={false}
            editId={editing.id}
            onSaved={edited}
            onCancel={stopEditing}
          />
        )}
      </Sheet>
    </div>
  );
}
