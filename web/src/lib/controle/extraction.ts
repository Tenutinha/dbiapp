/**
 * The shape the receipt reader (Claude) answers in, and how that answer becomes a draft the
 * person checks. Pure: the model's output is external data and is cleaned here before any use.
 */
import { z } from "zod";
import { lineTotal, reaisToCents, sumCents } from "./money";
import { isValidDay, MAX_ITEMS, PAYMENT_METHODS, type PurchaseDraft, type PurchaseItemInput } from "./schema";

/** Field names in Portuguese on purpose: they are part of the prompt the model reads. */
export const receiptReading = z.object({
  comprovante_legivel: z.boolean().describe("true quando a imagem é um comprovante de compra legível (nota, cupom, recibo, pedido)"),
  fornecedor: z.string().nullable().describe("nome da loja ou do fornecedor"),
  data: z.string().nullable().describe("data da compra no formato AAAA-MM-DD"),
  total: z.number().nullable().describe("valor total pago, em reais, com ponto decimal"),
  forma_pagamento: z.enum(PAYMENT_METHODS).nullable(),
  itens: z.array(
    z.object({
      descricao: z.string(),
      quantidade: z.number(),
      unidade: z.string().nullable().describe("un, kg, g, l, ml, cx, pct…"),
      valor_unitario: z.number().nullable().describe("preço de uma unidade, em reais"),
      valor_total: z.number().describe("valor da linha, em reais"),
    }),
  ),
  observacao: z.string().nullable().describe("desconto, troco, trecho ilegível ou outra ressalva; null quando não há"),
});

export type ReceiptReading = z.infer<typeof receiptReading>;

const clip = (text: string | null, max: number): string | null => {
  const clean = text?.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
};

function toItem(raw: ReceiptReading["itens"][number]): PurchaseItemInput | null {
  const description = clip(raw.descricao, 200);
  if (!description) return null;
  const quantity = Number.isFinite(raw.quantidade) && raw.quantidade > 0 && raw.quantidade <= 1_000_000
    ? Math.max(0.001, Math.round(raw.quantidade * 1000) / 1000)
    : 1;
  const unitPriceCents = reaisToCents(raw.valor_unitario);
  const total = reaisToCents(raw.valor_total);
  // A zero line next to a unit price is a misread, not a free item: quantity × unit price stands in.
  const totalCents = total !== null && (total > 0 || !unitPriceCents) ? total : unitPriceCents === null ? null : lineTotal(quantity, unitPriceCents);
  if (totalCents === null) return null;
  return { description, quantity, unit: clip(raw.unidade, 12), unitPriceCents, totalCents };
}

/** Turns what the model read into a draft: amounts in cents, impossible values dropped, nothing invented. */
export function toDraft(reading: ReceiptReading, today: Date = new Date()): PurchaseDraft {
  const items = reading.itens.map(toItem).filter((i): i is PurchaseItemInput => i !== null).slice(0, MAX_ITEMS);
  const total = reaisToCents(reading.total);
  return {
    readable: reading.comprovante_legivel,
    supplier: clip(reading.fornecedor, 120),
    purchasedOn: reading.data && isValidDay(reading.data, today) ? reading.data : null,
    // No total on the paper: the sum of the lines is the best starting point (the person confirms it).
    totalCents: total ?? (items.length > 0 ? sumCents(items.map((i) => i.totalCents)) : null),
    paymentMethod: reading.forma_pagamento,
    notes: clip(reading.observacao, 500),
    items,
  };
}
