/**
 * The period of the "controle" screen: one or more months ("competências"), or the last N days.
 * Pure — the page (server), the picker (browser) and the tests share it.
 *
 * Address: `?mes=2026-10,2026-11` (months, any order) or `?dias=15` (last days, today included).
 * Nothing valid → the current month.
 */
import { monthLabel, shiftDay, todayInBrazil } from "./schema";

export const LAST_DAYS = [7, 15, 30, 45] as const;
export type LastDays = (typeof LAST_DAYS)[number];

/** At most this many months at once (a year), so the address and the queries stay small. */
export const MAX_MONTHS = 12;

export type Period = { kind: "months"; months: string[] } | { kind: "days"; days: LastDays };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** Months of `text` ("2026-11,2026-10"): valid ones only, without repeats, oldest first, at most MAX_MONTHS. */
export function parseMonths(text: string | undefined): string[] {
  if (!text) return [];
  const valid = text.split(",").map((m) => m.trim()).filter((m) => MONTH.test(m));
  return [...new Set(valid)].sort().slice(-MAX_MONTHS);
}

/** The period asked in the address; the current month when nothing valid is there. */
export function parsePeriod(query: { mes?: string | string[]; dias?: string | string[] }, now: Date = new Date()): Period {
  const days = Number(first(query.dias));
  if ((LAST_DAYS as readonly number[]).includes(days)) return { kind: "days", days: days as LastDays };
  const months = parseMonths(first(query.mes));
  return { kind: "months", months: months.length > 0 ? months : [todayInBrazil(now).slice(0, 7)] };
}

/** Every day of a month, "aaaa-mm-dd", in order. */
export function monthDays(month: string): string[] {
  const [year, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Every day the period covers, oldest first (the last N days end today). */
export function periodDays(period: Period, today: string): string[] {
  if (period.kind === "months") return period.months.flatMap(monthDays);
  return Array.from({ length: period.days }, (_, i) => shiftDay(today, i - period.days + 1));
}

/** The single month of the period, when it is just one (the ‹ › arrows only make sense then). */
export function singleMonth(period: Period): string | null {
  return period.kind === "months" && period.months.length === 1 ? period.months[0] : null;
}

/** The month the "últimos meses" chart ends on: the last chosen month, or today's. */
export function lastMonth(period: Period, today: string): string {
  return period.kind === "months" ? period.months[period.months.length - 1] : today.slice(0, 7);
}

const SHORT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const shortMonth = (month: string): string => `${SHORT_MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(2, 4)}`;

/** "novembro de 2026" · "out/26, nov/26" · "5 competências" · "Últimos 15 dias". */
export function periodLabel(period: Period): string {
  if (period.kind === "days") return `Últimos ${period.days} dias`;
  if (period.months.length === 1) return monthLabel(period.months[0]);
  if (period.months.length <= 3) return period.months.map(shortMonth).join(", ");
  return `${period.months.length} competências`;
}

/** What follows "?" in the address for this period ("" = the current month, the default). */
export function periodQuery(period: Period, currentMonth: string): string {
  if (period.kind === "days") return `dias=${period.days}`;
  if (period.months.length === 1 && period.months[0] === currentMonth) return "";
  return `mes=${period.months.join(",")}`;
}

/** Months offered in the picker: the last `back` months, the current one and `ahead` to come (entries may be dated ahead), newest first. */
export function monthChoices(today: string, back = 12, ahead = 2): string[] {
  const [year, m] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: back + ahead + 1 }, (_, i) => {
    const date = new Date(Date.UTC(year, m - 1 + ahead - i, 1));
    return date.toISOString().slice(0, 7);
  });
}
