"use client";

import { useState } from "react";
import { formatMoney, lineTotal, moneyInput, parseMoney, parseQuantity, sumCents } from "@/lib/controle/money";
import { isValidDay, MAX_ITEMS, type PaymentMethod, type PurchaseDraft, type PurchaseInput } from "@/lib/controle/schema";
import { call, ControleError, type SentReceipt } from "./api";
import type { EntryStatus } from "@/lib/controle/status";
import { ErrorNote, Field, INPUT, PaymentPicker, StatusPicker } from "./fields";

interface Line {
  key: number;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  total: string;
}

interface PurchaseFormProps {
  api: string;
  today: string;
  /** What the receipt reader found (or an empty draft when typing by hand). */
  draft: PurchaseDraft;
  receipt: SentReceipt | null;
  /** Whether the draft came from the reader (kept with the purchase). */
  fromReceipt: boolean;
  /** Set when correcting a saved purchase: it is rewritten instead of created (its receipt is kept). */
  editId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

const quantityInput = (n: number): string => String(n).replace(".", ",");

function toLines(draft: PurchaseDraft): Line[] {
  return draft.items.map((item, key) => ({
    key,
    description: item.description,
    quantity: quantityInput(item.quantity),
    unit: item.unit ?? "",
    unitPrice: moneyInput(item.unitPriceCents),
    total: moneyInput(item.totalCents),
  }));
}

const blankLine = (key: number): Line => ({ key, description: "", quantity: "1", unit: "", unitPrice: "", total: "" });

/** Quantity × unit price fills the line total whenever both are readable. */
function withTotal(line: Line): Line {
  const quantity = parseQuantity(line.quantity);
  const unitPrice = parseMoney(line.unitPrice);
  return quantity !== null && unitPrice !== null ? { ...line, total: moneyInput(lineTotal(quantity, unitPrice)) } : line;
}

/** The purchase as the API takes it, or the first thing the person has to fix. */
function build(fields: { day: string; supplier: string; total: string; payment: PaymentMethod | null; notes: string; status: EntryStatus }, lines: Line[]): PurchaseInput | string {
  if (!isValidDay(fields.day)) return "Informe a data da despesa.";
  const totalCents = parseMoney(fields.total);
  if (totalCents === null) return "Informe o valor total da despesa.";
  const items: PurchaseInput["items"] = [];
  for (const [index, line] of lines.entries()) {
    const description = line.description.trim();
    const quantity = parseQuantity(line.quantity);
    const total = parseMoney(line.total);
    if (!description) return `Item ${index + 1}: falta a descrição.`;
    if (quantity === null) return `Item ${index + 1}: quantidade inválida.`;
    if (total === null) return `Item ${index + 1}: falta o valor.`;
    items.push({ description, quantity, unit: line.unit.trim() || null, unitPriceCents: parseMoney(line.unitPrice), totalCents: total });
  }
  return {
    purchasedOn: fields.day,
    supplier: fields.supplier.trim() || null,
    totalCents,
    paymentMethod: fields.payment,
    notes: fields.notes.trim() || null,
    receipt: null,
    fromReceipt: false,
    status: fields.status,
    items,
  };
}

/** Checking screen of a purchase: everything the reader found is editable before it is saved. */
export function PurchaseForm({ api, today, draft, receipt, fromReceipt, editId, onSaved, onCancel }: PurchaseFormProps) {
  const [day, setDay] = useState(draft.purchasedOn ?? today);
  const [supplier, setSupplier] = useState(draft.supplier ?? "");
  const [total, setTotal] = useState(moneyInput(draft.totalCents));
  const [payment, setPayment] = useState<PaymentMethod | null>(draft.paymentMethod);
  const [notes, setNotes] = useState(draft.notes ?? "");
  const [status, setStatus] = useState<EntryStatus>(draft.status ?? "efetivado");
  const [lines, setLines] = useState<Line[]>(() => toLines(draft));
  const [nextKey, setNextKey] = useState(draft.items.length);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const itemsSum = sumCents(lines.map((l) => parseMoney(l.total) ?? 0));
  const totalCents = parseMoney(total);
  const mismatch = lines.length > 0 && totalCents !== null && itemsSum !== totalCents;

  const change = (key: number, patch: Partial<Line>, recompute = false): void =>
    setLines((current) => current.map((l) => (l.key === key ? (recompute ? withTotal({ ...l, ...patch }) : { ...l, ...patch }) : l)));

  function addLine(): void {
    setLines((current) => [...current, blankLine(nextKey)]);
    setNextKey((k) => k + 1);
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const built = build({ day, supplier, total, payment, notes, status }, lines);
    if (typeof built === "string") {
      setError(built);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editId) await call(api, { action: "purchaseUpdate", id: editId, purchase: built });
      else await call(api, { action: "purchaseSave", purchase: { ...built, receipt, fromReceipt: fromReceipt && receipt !== null } });
      onSaved();
    } catch (err) {
      setError(err instanceof ControleError ? err.message : "Não foi possível salvar. Tente de novo.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data">
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={INPUT} required />
        </Field>
        <Field label="Total pago (R$)">
          <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" className={`${INPUT} font-semibold`} />
        </Field>
        <Field label="Fornecedor" className="col-span-2">
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Onde foi a despesa" maxLength={120} className={INPUT} />
        </Field>
      </div>

      <PaymentPicker value={payment} onChange={setPayment} />
      <StatusPicker kind="despesa" value={status} onChange={setStatus} />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Itens ({lines.length})</h3>
          {lines.length > 0 && <span className="text-xs text-muted">Soma: {formatMoney(itemsSum)}</span>}
        </div>
        {lines.map((line, index) => (
          <div key={line.key} className="rounded-xl border border-line p-3">
            <div className="flex items-start gap-2">
              <input
                aria-label={`Descrição do item ${index + 1}`}
                value={line.description}
                onChange={(e) => change(line.key, { description: e.target.value })}
                placeholder="Produto"
                maxLength={200}
                className={INPUT}
              />
              <button
                type="button"
                onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                aria-label={`Remover item ${index + 1}`}
                className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
              >
                ✕
              </button>
            </div>
            <div className="mt-2 grid grid-cols-[1fr_1fr_1.2fr_1.2fr] gap-2">
              <Field label="Qtd">
                <input inputMode="decimal" value={line.quantity} onChange={(e) => change(line.key, { quantity: e.target.value }, true)} className={INPUT} />
              </Field>
              <Field label="Un.">
                <input value={line.unit} onChange={(e) => change(line.key, { unit: e.target.value })} placeholder="un" maxLength={12} className={INPUT} />
              </Field>
              <Field label="Unitário">
                <input inputMode="decimal" value={line.unitPrice} onChange={(e) => change(line.key, { unitPrice: e.target.value }, true)} placeholder="0,00" className={INPUT} />
              </Field>
              <Field label="Valor">
                <input inputMode="decimal" value={line.total} onChange={(e) => change(line.key, { total: e.target.value })} placeholder="0,00" className={INPUT} />
              </Field>
            </div>
          </div>
        ))}
        {lines.length < MAX_ITEMS && (
          <button type="button" onClick={addLine} className="btn btn-ghost justify-center">+ Adicionar item</button>
        )}
        {mismatch && (
          <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
            Os itens somam {formatMoney(itemsSum)} e o total está {formatMoney(totalCents ?? 0)}. Pode ser desconto ou frete — confira.{" "}
            <button type="button" className="font-semibold underline" onClick={() => setTotal(moneyInput(itemsSum))}>
              Usar a soma dos itens
            </button>
          </p>
        )}
      </section>

      <Field label="Observação">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={INPUT} />
      </Field>

      <ErrorNote message={error} />
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-card/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={onCancel} disabled={saving} className="btn btn-ghost flex-1 justify-center">Cancelar</button>
        <button className="btn btn-primary flex-[2] justify-center" disabled={saving}>{saving ? "Salvando…" : editId ? "Salvar alterações" : "Salvar despesa"}</button>
      </div>
    </form>
  );
}
