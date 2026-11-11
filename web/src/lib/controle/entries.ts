/** Purchases and sales of a month as one list, the way the "controle" home shows them. Pure. */
import type { Purchase, Sale } from "./schema";

export type Entry =
  | { kind: "despesa"; id: string; day: string; createdAt: string; totalCents: number; purchase: Purchase }
  | { kind: "venda"; id: string; day: string; createdAt: string; totalCents: number; sale: Sale };

/** Everything recorded, newest day first; within a day, the latest entry first. */
export function mergeEntries(purchases: readonly Purchase[], sales: readonly Sale[]): Entry[] {
  const entries: Entry[] = [
    ...purchases.map((p): Entry => ({ kind: "despesa", id: p.id, day: p.purchasedOn, createdAt: p.createdAt, totalCents: p.totalCents, purchase: p })),
    ...sales.map((s): Entry => ({ kind: "venda", id: s.id, day: s.soldOn, createdAt: s.createdAt, totalCents: s.totalCents, sale: s })),
  ];
  return entries.sort((a, b) => b.day.localeCompare(a.day) || b.createdAt.localeCompare(a.createdAt));
}
