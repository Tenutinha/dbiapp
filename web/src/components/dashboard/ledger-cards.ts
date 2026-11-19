/**
 * The cards of a razonete visual (Ledger.tsx draws them): each account's balances and movement, and whether
 * they close. Pure.
 */
import { LEDGER_TOLERANCE } from "@/lib/templates/schema";

export interface LedgerSpec {
  field: string;
  detail?: string;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
  journal?: { debit: string; credit: string };
}

export interface LedgerCard {
  title: string;
  detail: string | null;
  /** Balances signed debit-positive. */
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  /** What the closing balance has beyond opening + debits − credits (0 when it closes). */
  balanceDiff: number;
  /** The journal's entries minus the balancete's movement, per side; null without a journal. */
  journal: { debitDiff: number; creditDiff: number } | null;
  ok: boolean;
}

const num = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};
/** Rounded to the cent, so a float's dust never shows as a difference. */
const cents = (n: number): number => Math.round(n * 100) / 100;
const closes = (diff: number): boolean => Math.abs(diff) <= LEDGER_TOLERANCE;

export function ledgerCards(spec: LedgerSpec, rows: readonly Readonly<Record<string, unknown>>[]): LedgerCard[] {
  return rows.map((row) => {
    const opening = num(row[spec.opening]);
    const debit = num(row[spec.debit]);
    const credit = num(row[spec.credit]);
    const closing = num(row[spec.closing]);
    const balanceDiff = cents(closing - (opening + debit - credit));
    const journal = spec.journal
      ? { debitDiff: cents(num(row[spec.journal.debit]) - debit), creditDiff: cents(num(row[spec.journal.credit]) - credit) }
      : null;
    const ok = closes(balanceDiff) && (journal === null || (closes(journal.debitDiff) && closes(journal.creditDiff)));
    const detail = spec.detail ? String(row[spec.detail] ?? "") || null : null;
    return { title: String(row[spec.field] ?? ""), detail, opening, debit, credit, closing, balanceDiff, journal, ok };
  });
}

/** The largest of a card's differences (what it is off by). */
export function offBy(card: LedgerCard): number {
  return Math.max(Math.abs(card.balanceDiff), Math.abs(card.journal?.debitDiff ?? 0), Math.abs(card.journal?.creditDiff ?? 0));
}

export function ledgerSummary(cards: readonly LedgerCard[]): { accounts: number; off: number; offValue: number } {
  const off = cards.filter((c) => !c.ok);
  return { accounts: cards.length, off: off.length, offValue: cents(off.reduce((sum, c) => sum + offBy(c), 0)) };
}

/** The side of a balance signed debit-positive. */
export const sideOf = (n: number): "D" | "C" | "" => (n > 0 ? "D" : n < 0 ? "C" : "");
