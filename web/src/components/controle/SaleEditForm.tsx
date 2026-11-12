"use client";

import { useState } from "react";
import { moneyInput, parseMoney } from "@/lib/controle/money";
import { isValidDay, type PaymentMethod, type Sale, type SaleInput } from "@/lib/controle/schema";
import { call, ControleError } from "./api";
import type { EntryStatus } from "@/lib/controle/status";
import { ErrorNote, Field, INPUT, PaymentPicker, StatusPicker } from "./fields";

interface SaleEditFormProps {
  api: string;
  sale: Sale;
  onSaved: () => void;
  onCancel: () => void;
}

/** A recorded sale, all on one screen to be corrected: amount, day, payment and the customer's name. */
export function SaleEditForm({ api, sale, onSaved, onCancel }: SaleEditFormProps) {
  const [total, setTotal] = useState(moneyInput(sale.totalCents));
  const [day, setDay] = useState(sale.soldOn);
  const [payment, setPayment] = useState<PaymentMethod | null>(sale.paymentMethod);
  const [customer, setCustomer] = useState(sale.customerName ?? "");
  const [status, setStatus] = useState<EntryStatus>(sale.status);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const totalCents = parseMoney(total);
    if (totalCents === null || totalCents <= 0) return setError("Informe o valor da venda.");
    if (!isValidDay(day)) return setError("Informe a data da venda.");
    const input: SaleInput = { soldOn: day, totalCents, paymentMethod: payment, customerName: customer.trim() || null, status };
    setSaving(true);
    setError(null);
    try {
      await call(api, { action: "saleUpdate", id: sale.id, sale: input });
      onSaved();
    } catch (err) {
      setError(err instanceof ControleError ? err.message : "Não foi possível salvar. Tente de novo.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor (R$)">
          <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" className={`${INPUT} font-semibold`} />
        </Field>
        <Field label="Data">
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={INPUT} required />
        </Field>
        <Field label="Nome do cliente (opcional)" className="col-span-2">
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={120} autoComplete="off" className={INPUT} />
        </Field>
      </div>
      <PaymentPicker value={payment} onChange={setPayment} />
      <StatusPicker kind="venda" value={status} onChange={setStatus} />
      <ErrorNote message={error} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="btn btn-ghost flex-1 justify-center">Cancelar</button>
        <button className="btn btn-primary flex-[2] justify-center" disabled={saving}>{saving ? "Salvando…" : "Salvar alterações"}</button>
      </div>
    </form>
  );
}
