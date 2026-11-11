/**
 * Purchases and sales of the "controle" module (migration 015). Every statement is scoped by the
 * client it belongs to, so an id from another client never matches. Amounts are bigint cents and
 * quantities numeric in the database; they are read as plain numbers (far below 2^53).
 */
import "server-only";
import { sql } from "../db";
import type { Purchase, PurchaseInput, Sale, SaleInput } from "../controle/schema";
import type { SeriesPoint } from "../controle/series";

export interface Space {
  orgId: string;
  clientId: string;
}

/** Optional modules turned on for an organization (e.g. ["controle"]). */
export async function orgModules(orgId: string): Promise<string[]> {
  const [row] = await sql<{ modules: string[] | null }[]>`
    SELECT to_jsonb(o) -> 'modules' AS modules FROM organizations o WHERE o.id = ${orgId}`; // null before migration 015
  return row?.modules ?? [];
}

/** The days of a period as a date[] parameter (see lib/controle/period.ts: periodDays). */
const dayList = (days: readonly string[]): string[] => [...days];

export interface PeriodTotals {
  purchasesCents: number;
  purchases: number;
  salesCents: number;
  sales: number;
}

/** Totals of the given days (a month, several months or the last days). */
export async function periodTotals(clientId: string, days: readonly string[]): Promise<PeriodTotals> {
  const list = dayList(days);
  const [row] = await sql<PeriodTotals[]>`
    SELECT
      (SELECT COALESCE(SUM(total_cents), 0)::float8 FROM controle_purchases
        WHERE client_id = ${clientId} AND purchased_on = ANY(${list}::date[])) AS "purchasesCents",
      (SELECT COUNT(*)::int FROM controle_purchases
        WHERE client_id = ${clientId} AND purchased_on = ANY(${list}::date[])) AS purchases,
      (SELECT COALESCE(SUM(total_cents), 0)::float8 FROM controle_sales
        WHERE client_id = ${clientId} AND sold_on = ANY(${list}::date[])) AS "salesCents",
      (SELECT COUNT(*)::int FROM controle_sales
        WHERE client_id = ${clientId} AND sold_on = ANY(${list}::date[])) AS sales`;
  return row;
}

// ---------- purchases ----------

export async function listPurchases(clientId: string, days: readonly string[]): Promise<Purchase[]> {
  const list = dayList(days);
  return sql<Purchase[]>`
    SELECT p.id, to_char(p.purchased_on, 'YYYY-MM-DD') AS "purchasedOn", p.supplier,
           p.total_cents::float8 AS "totalCents", p.payment_method AS "paymentMethod", p.notes,
           (p.receipt_path IS NOT NULL) AS "hasReceipt", (p.source = 'ai') AS "fromReceipt",
           to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt",
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', i.id, 'description', i.description, 'quantity', i.quantity::float8, 'unit', i.unit,
               'unitPriceCents', i.unit_price_cents::float8, 'totalCents', i.total_cents::float8) ORDER BY i.position)
             FROM controle_purchase_items i WHERE i.purchase_id = p.id), '[]'::jsonb) AS items
    FROM controle_purchases p
    WHERE p.client_id = ${clientId} AND p.purchased_on = ANY(${list}::date[])
    ORDER BY p.purchased_on DESC, p.created_at DESC`;
}

/** Saves a purchase and its lines together (all or nothing). Returns the new id. */
export async function insertPurchase(space: Space, userId: string, input: PurchaseInput): Promise<string> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO controle_purchases
        (organization_id, client_id, purchased_on, supplier, total_cents, payment_method, notes, receipt_path, receipt_mime, source, created_by)
      VALUES (${space.orgId}, ${space.clientId}, ${input.purchasedOn}::date, ${input.supplier}, ${input.totalCents},
              ${input.paymentMethod}, ${input.notes}, ${input.receipt?.path ?? null}, ${input.receipt?.mime ?? null},
              ${input.fromReceipt ? "ai" : "manual"}, ${userId})
      RETURNING id`;
    const lines = input.items.map((item, position) => ({
      purchase_id: row.id,
      position,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price_cents: item.unitPriceCents,
      total_cents: item.totalCents,
    }));
    if (lines.length > 0) await tx`INSERT INTO controle_purchase_items ${tx(lines)}`;
    return row.id;
  });
}

export interface StoredReceipt {
  path: string;
  mime: string;
}

/** The receipt of one purchase of this client; null when the purchase has none (or is not this client's). */
export async function findReceipt(clientId: string, purchaseId: string): Promise<StoredReceipt | null> {
  const [row] = await sql<{ path: string | null; mime: string | null }[]>`
    SELECT receipt_path AS path, receipt_mime AS mime FROM controle_purchases WHERE id = ${purchaseId} AND client_id = ${clientId}`;
  return row?.path && row.mime ? { path: row.path, mime: row.mime } : null;
}

/** Whether a receipt path is already attached to a purchase of this client (one file, one purchase). */
export async function receiptInUse(clientId: string, path: string): Promise<boolean> {
  const [row] = await sql<{ used: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM controle_purchases WHERE client_id = ${clientId} AND receipt_path = ${path}) AS used`;
  return row.used;
}

/** Rewrites a purchase of this client and its lines (all or nothing); the receipt stays as it is. False when it is gone. */
export async function updatePurchase(clientId: string, purchaseId: string, input: PurchaseInput): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows = await tx`
      UPDATE controle_purchases
      SET purchased_on = ${input.purchasedOn}::date, supplier = ${input.supplier}, total_cents = ${input.totalCents},
          payment_method = ${input.paymentMethod}, notes = ${input.notes}
      WHERE id = ${purchaseId} AND client_id = ${clientId}
      RETURNING id`;
    if (rows.length === 0) return false;
    await tx`DELETE FROM controle_purchase_items WHERE purchase_id = ${purchaseId}`;
    const lines = input.items.map((item, position) => ({
      purchase_id: purchaseId,
      position,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price_cents: item.unitPriceCents,
      total_cents: item.totalCents,
    }));
    if (lines.length > 0) await tx`INSERT INTO controle_purchase_items ${tx(lines)}`;
    return true;
  });
}

/** Deletes a purchase of this client. Returns its receipt path (to delete the file) and whether it existed. */
export async function deletePurchase(clientId: string, purchaseId: string): Promise<{ found: boolean; receiptPath: string | null }> {
  const rows = await sql<{ receiptPath: string | null }[]>`
    DELETE FROM controle_purchases WHERE id = ${purchaseId} AND client_id = ${clientId} RETURNING receipt_path AS "receiptPath"`;
  return { found: rows.length > 0, receiptPath: rows[0]?.receiptPath ?? null };
}

// ---------- sales ----------

export async function listSales(clientId: string, days: readonly string[]): Promise<Sale[]> {
  const list = dayList(days);
  return sql<Sale[]>`
    SELECT id, to_char(sold_on, 'YYYY-MM-DD') AS "soldOn", total_cents::float8 AS "totalCents",
           payment_method AS "paymentMethod", customer_name AS "customerName", product,
           to_char(controle_sales.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt"
    FROM controle_sales
    WHERE client_id = ${clientId} AND sold_on = ANY(${list}::date[])
    ORDER BY sold_on DESC, created_at DESC`;
}

export async function insertSale(space: Space, userId: string, input: SaleInput): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO controle_sales
      (organization_id, client_id, sold_on, total_cents, payment_method, customer_name, created_by)
    VALUES (${space.orgId}, ${space.clientId}, ${input.soldOn}::date, ${input.totalCents},
            ${input.paymentMethod}, ${input.customerName}, ${userId})
    RETURNING id`;
  return row.id;
}

/** Rewrites a sale of this client. False when it is gone. */
export async function updateSale(clientId: string, saleId: string, input: SaleInput): Promise<boolean> {
  const updated = await sql`
    UPDATE controle_sales
    SET sold_on = ${input.soldOn}::date, total_cents = ${input.totalCents},
        payment_method = ${input.paymentMethod}, customer_name = ${input.customerName}
    WHERE id = ${saleId} AND client_id = ${clientId}`;
  return updated.count > 0;
}

export async function deleteSale(clientId: string, saleId: string): Promise<boolean> {
  const deleted = await sql`DELETE FROM controle_sales WHERE id = ${saleId} AND client_id = ${clientId}`;
  return deleted.count > 0;
}

// ---------- evolution ----------

/** Sales and purchases of each of the given days, in that order (days with nothing come as zero). */
export async function dailySeries(clientId: string, days: readonly string[]): Promise<SeriesPoint[]> {
  const list = dayList(days);
  return sql<SeriesPoint[]>`
    SELECT to_char(d, 'YYYY-MM-DD') AS period,
      COALESCE((SELECT SUM(total_cents) FROM controle_sales WHERE client_id = ${clientId} AND sold_on = d), 0)::float8 AS "salesCents",
      COALESCE((SELECT SUM(total_cents) FROM controle_purchases WHERE client_id = ${clientId} AND purchased_on = d), 0)::float8 AS "purchasesCents"
    FROM unnest(${list}::date[]) AS d
    ORDER BY d`;
}

/** Sales and purchases of each of the `months` months that end in `month`, oldest first. */
export async function monthlySeries(clientId: string, month: string, months = 6): Promise<SeriesPoint[]> {
  const start = `${month}-01`;
  return sql<SeriesPoint[]>`
    SELECT to_char(m, 'YYYY-MM') AS period,
      COALESCE((SELECT SUM(total_cents) FROM controle_sales
        WHERE client_id = ${clientId} AND sold_on >= m::date AND sold_on < (m + interval '1 month')::date), 0)::float8 AS "salesCents",
      COALESCE((SELECT SUM(total_cents) FROM controle_purchases
        WHERE client_id = ${clientId} AND purchased_on >= m::date AND purchased_on < (m + interval '1 month')::date), 0)::float8 AS "purchasesCents"
    FROM generate_series(${start}::date - make_interval(months => ${months - 1}::int), ${start}::date, interval '1 month') m
    ORDER BY m`;
}
