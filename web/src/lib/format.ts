import type { ValueFormat } from "./templates/schema";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
/** Money to the cent, without the "R$": in a table full of values the symbol only adds noise. */
const currencyExact = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currencyCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export function formatValue(value: unknown, format: ValueFormat, compact = false): string {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "text") return String(value);
  if (format === "date") return formatDay(value);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  switch (format) {
    case "currency":
      return compact && Math.abs(n) >= 10_000 ? currencyCompact.format(n) : currency.format(n);
    // Always whole: it is the format for values that must match a document to the cent.
    case "currency_exact":
      return currencyExact.format(n);
    case "percent":
      return percent.format(n);
    case "integer":
      return integer.format(n);
    default:
      return number.format(n);
  }
}

/** "2026-12-31" (or a Date) → "31/12/2026"; anything else as it came. */
function formatDay(value: unknown): string {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${number.format(v)} ${units[i]}`;
}

/** "6 de novembro de 2026" */
export function formatDateLong(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(d));
}

/** "12/11/2026" */
export function formatDateShort(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(d));
}

export function formatDateTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(d));
}
