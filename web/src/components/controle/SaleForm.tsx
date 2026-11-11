"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { lineTotal, moneyInput, parseMoney, parseQuantity } from "@/lib/controle/money";
import { isValidDay, type PaymentMethod, type SaleInput } from "@/lib/controle/schema";
import { call, ControleError } from "./api";
import { ErrorNote, Field, INPUT, PaymentPicker } from "./fields";

interface KnownProduct {
  product: string;
  unitPriceCents: number | null;
}

interface SaleFormProps {
  api: string;
  today: string;
  /** Products already sold by this client, with their last price — suggestions while typing. */
  products: KnownProduct[];
}

/** Total follows quantity × price while both are readable; otherwise what was typed stays. */
function autoTotal(quantity: string, unitPrice: string, current: string): string {
  const q = parseQuantity(quantity);
  const price = parseMoney(unitPrice);
  return q !== null && price !== null ? moneyInput(lineTotal(q, price)) : current;
}

/** One sale at a time, made to be typed with a thumb: product, quantity, price — and it is ready for the next. */
export function SaleForm({ api, today, products }: SaleFormProps) {
  const router = useRouter();
  const productRef = useRef<HTMLInputElement>(null);
  const [day, setDay] = useState(today);
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [total, setTotal] = useState("");
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function pickProduct(name: string): void {
    setProduct(name);
    // A product sold before brings its last price along.
    const known = products.find((p) => p.product.toLowerCase() === name.trim().toLowerCase());
    if (known?.unitPriceCents !== null && known?.unitPriceCents !== undefined && unitPrice === "") {
      const price = moneyInput(known.unitPriceCents);
      setUnitPrice(price);
      setTotal(autoTotal(quantity, price, total));
    }
  }

  function build(): SaleInput | string {
    if (!isValidDay(day)) return "Informe a data da venda.";
    if (!product.trim()) return "Informe o produto.";
    const q = parseQuantity(quantity);
    if (q === null) return "Quantidade inválida.";
    const totalCents = parseMoney(total);
    if (totalCents === null) return "Informe o valor da venda.";
    return {
      soldOn: day,
      product: product.trim(),
      quantity: q,
      unitPriceCents: parseMoney(unitPrice),
      totalCents,
      paymentMethod: payment,
      notes: notes.trim() || null,
    };
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const sale = build();
    setSaved(null);
    if (typeof sale === "string") {
      setError(sale);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await call(api, { action: "saleSave", sale });
      setSaved(`Venda de ${sale.product} lançada.`);
      // Day and payment stay: several sales of the same day are usually typed in a row.
      setProduct("");
      setQuantity("1");
      setUnitPrice("");
      setTotal("");
      setNotes("");
      productRef.current?.focus();
      router.refresh();
    } catch (err) {
      setError(err instanceof ControleError ? err.message : "Não foi possível salvar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3 p-4" noValidate>
      <h2 className="text-lg font-bold">Nova venda</h2>
      <Field label="Produto">
        <input
          ref={productRef}
          value={product}
          onChange={(e) => pickProduct(e.target.value)}
          list="controle-produtos"
          placeholder="O que foi vendido"
          maxLength={120}
          autoComplete="off"
          className={INPUT}
        />
        <datalist id="controle-produtos">
          {products.map((p) => <option key={p.product} value={p.product} />)}
        </datalist>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Qtd">
          <input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => { setQuantity(e.target.value); setTotal(autoTotal(e.target.value, unitPrice, total)); }}
            className={INPUT}
          />
        </Field>
        <Field label="Preço (R$)">
          <input
            inputMode="decimal"
            value={unitPrice}
            onChange={(e) => { setUnitPrice(e.target.value); setTotal(autoTotal(quantity, e.target.value, total)); }}
            placeholder="0,00"
            className={INPUT}
          />
        </Field>
        <Field label="Total (R$)">
          <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" className={`${INPUT} font-semibold`} />
        </Field>
      </div>
      <PaymentPicker value={payment} onChange={setPayment} />
      <div className="grid grid-cols-[auto_1fr] gap-3">
        <Field label="Data">
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} className={INPUT} />
        </Field>
        <Field label="Observação">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={INPUT} />
        </Field>
      </div>
      <ErrorNote message={error} />
      {saved && <p role="status" className="text-sm text-ok">{saved}</p>}
      <button className="btn btn-primary justify-center py-3 text-base" disabled={saving}>{saving ? "Lançando…" : "Lançar venda"}</button>
    </form>
  );
}
