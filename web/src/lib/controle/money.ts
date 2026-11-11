/**
 * Money and quantities of the "controle" module. Amounts are always whole cents (never floats);
 * these helpers run in the browser and on the server.
 */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const qty = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** Largest amount accepted in one entry: R$ 100 million. */
export const MAX_CENTS = 10_000_000_000;

/** 1250 → "R$ 12,50" */
export function formatMoney(cents: number): string {
  return brl.format(cents / 100);
}

/** 1250 → "12,50" (what goes in a text field) */
export function moneyInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/** 1.5 → "1,5" */
export function formatQuantity(quantity: number): string {
  return qty.format(quantity);
}

/**
 * A number as people type it in Brazil: "1.234,56", "12,5", "12.50", "R$ 10". The last comma or dot
 * followed by one or two digits is the decimal mark; any other separator groups thousands.
 */
function parseDecimal(text: string): number | null {
  const clean = text.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(clean) || clean.includes("-")) return null;
  const mark = Math.max(clean.lastIndexOf(","), clean.lastIndexOf("."));
  const decimals = mark === -1 ? 0 : clean.length - mark - 1;
  const comma = clean.includes(",");
  // "1.234" (dot, three digits, no comma) is one thousand…; "1,234" is read as 1.234 (a quantity).
  // "0.250" can only be a fraction: nobody groups thousands after a zero.
  const afterZero = mark !== -1 && /^0+$/.test(clean.slice(0, mark));
  const isDecimal = mark !== -1 && (decimals <= 2 || afterZero || (comma && clean[mark] === ","));
  const whole = (isDecimal ? clean.slice(0, mark) : clean).replace(/[.,]/g, "");
  const fraction = isDecimal ? clean.slice(mark + 1).replace(/[.,]/g, "") : "";
  const value = Number(`${whole || "0"}.${fraction || "0"}`);
  return Number.isFinite(value) ? value : null;
}

/** "12,50" → 1250; null when it is not an amount (or is out of range). */
export function parseMoney(text: string): number | null {
  const value = parseDecimal(text);
  if (value === null) return null;
  const cents = Math.round(value * 100);
  return cents <= MAX_CENTS ? cents : null;
}

/** "1,5" → 1.5; null when it is not a positive quantity. */
export function parseQuantity(text: string): number | null {
  const value = parseDecimal(text);
  if (value === null || value <= 0 || value > 1_000_000) return null;
  return Math.round(value * 1000) / 1000;
}

/** A decimal amount in reais (as the receipt reader returns it) → cents; null when unusable. */
export function reaisToCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  return cents <= MAX_CENTS ? cents : null;
}

/** quantity × unit price, in whole cents. */
export function lineTotal(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}
