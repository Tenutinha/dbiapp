/**
 * What a purchase and a sale look like when they arrive from the screen. Shared by the browser
 * (types, labels) and the API (validation) — no server-only imports here.
 */
import { z } from "zod";
import { MAX_CENTS } from "./money";

export const PAYMENT_METHODS = ["pix", "dinheiro", "debito", "credito", "boleto", "outro"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  debito: "Débito",
  credito: "Crédito",
  boleto: "Boleto",
  outro: "Outro",
};

export const MAX_ITEMS = 200;

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Today in Brazil ("2026-11-11") — the server runs in UTC, where the day turns three hours earlier. */
export function todayInBrazil(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

/** How far ahead an entry may be dated: bills and sales already agreed are recorded before their day comes. */
export const MAX_YEARS_AHEAD = 5;

/** The last day an entry may carry: today in Brazil plus MAX_YEARS_AHEAD years. */
export function lastValidDay(now: Date = new Date()): string {
  const today = todayInBrazil(now);
  return `${Number(today.slice(0, 4)) + MAX_YEARS_AHEAD}${today.slice(4)}`;
}

/** "2026-11-11" for a real calendar day (no 31st of February), from 2000 up to a few years ahead (see lastValidDay). */
export function isValidDay(text: string, now: Date = new Date()): boolean {
  if (!DAY.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return false;
  return text >= "2000-01-01" && text <= lastValidDay(now);
}

/** The month of the screen: the one asked in the address when valid, else the current one. */
export function monthOrCurrent(text: string | undefined, now: Date = new Date()): string {
  return text && MONTH.test(text) ? text : todayInBrazil(now).slice(0, 7);
}

/** "2026-11" + 1 → "2026-12"; + -1 → "2026-10". */
export function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

/** "2026-11" → "novembro de 2026" */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** "2026-11-11" + -1 → "2026-11-10". */
export function shiftDay(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

/** "2026-11-11" → "11/11" */
export function dayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

const day = z.string().refine((v) => isValidDay(v), "data inválida");
const cents = z.number().int().min(0).max(MAX_CENTS);
/** Stored with three decimals: anything smaller would round to zero. */
const quantity = z.number().min(0.001).max(1_000_000);
const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const payment = z.enum(PAYMENT_METHODS).nullish().transform((v) => v ?? null);

/** A stored receipt, by its path inside the client's folder (see receipts.ts). */
export const receiptRef = z.object({ path: z.string().min(1).max(200), mime: z.string().min(1).max(60) });

export const purchaseItemInput = z.object({
  description: z.string().trim().min(1).max(200),
  quantity,
  unit: optionalText(12),
  unitPriceCents: cents.nullish().transform((v) => v ?? null),
  totalCents: cents,
});

export const purchaseInput = z.object({
  purchasedOn: day,
  supplier: optionalText(120),
  totalCents: cents,
  paymentMethod: payment,
  notes: optionalText(500),
  receipt: receiptRef.nullish().transform((v) => v ?? null),
  /** Whether the entry started from the receipt reader. */
  fromReceipt: z.boolean().default(false),
  items: z.array(purchaseItemInput).max(MAX_ITEMS),
});

/** A sale is its amount; how it was paid, when, and (only if the person wants) who bought. */
export const saleInput = z.object({
  soldOn: day,
  totalCents: cents.min(1),
  paymentMethod: payment,
  customerName: optionalText(120),
});

export type PurchaseItemInput = z.output<typeof purchaseItemInput>;
export type PurchaseInput = z.output<typeof purchaseInput>;
export type SaleInput = z.output<typeof saleInput>;

/** A purchase read from a receipt, before the person checks it. Unknown fields come empty. */
export interface PurchaseDraft {
  /** False when the picture is not a readable proof of purchase. */
  readable: boolean;
  supplier: string | null;
  purchasedOn: string | null;
  totalCents: number | null;
  paymentMethod: PaymentMethod | null;
  notes: string | null;
  items: PurchaseItemInput[];
}

// ---------- what the screens list ----------

export interface PurchaseItem extends PurchaseItemInput {
  id: string;
}

/** Who recorded an entry, as the list shows it. */
export interface Author {
  name: string;
  /** Their picture; null shows the initials. */
  avatarUrl: string | null;
}

export interface Purchase {
  id: string;
  /** Null when the person's account no longer exists. */
  author: Author | null;
  purchasedOn: string;
  supplier: string | null;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  notes: string | null;
  hasReceipt: boolean;
  fromReceipt: boolean;
  /** When it was recorded (UTC, sortable text) — orders entries of the same day. */
  createdAt: string;
  items: PurchaseItem[];
}

export interface Sale {
  id: string;
  author: Author | null;
  soldOn: string;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  customerName: string | null;
  /** Only on sales recorded before the amount-only form. */
  product: string | null;
  createdAt: string;
}
