/**
 * The items of an NFC-e read straight from the HTML of its public page on the SEFAZ, without the
 * AI: description, code, quantity, unit, unit price and line total. Pure — server and tests.
 *
 * Two layouts cover the state portals:
 * - the national one (SP, PR, MG, BA, GO, RJ…): a `tabResult` table, one `<tr>` per item, with
 *   `<span class="txtTit">` (description), `RCod` (code), `Rqtd`, `RUN`, `RvlUnit` and
 *   `<span class="valor">` (line total);
 * - a plain table with a header row (RS and others): "Código | Descrição | Qtde | Un | Vl Unit | Vl Total".
 *
 * Amounts come in the Brazilian format ("1.234,56"). Whatever cannot be read is left out: an empty
 * list means "use what the AI read".
 */
import { lineTotal, parseMoney, parseQuantity, sumCents } from "./money";
import { pageText } from "./nfce";
import { MAX_ITEMS, type PurchaseDraft, type PurchaseItemInput } from "./schema";

export interface NfceItem extends PurchaseItemInput {
  /** The store's product code, when the page shows one. */
  code: string | null;
}

/** Text of an HTML fragment: tags out, entities decoded, spaces collapsed. */
const textOf = (fragment: string): string => pageText(fragment).replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();

/** Inner HTML of the first element whose class list has `name` (case-insensitive). */
function byClass(html: string, name: string): string | null {
  const re = new RegExp(`<(\\w+)[^>]*\\bclass\\s*=\\s*["'](?:[^"']*\\s)?${name}(?:\\s[^"']*)?["'][^>]*>([\\s\\S]*?)</\\1>`, "i");
  return re.exec(html)?.[2] ?? null;
}

/** The value after a label: "Qtde.: 1,5" → "1,5", "UN: KG" → "KG", "Vl. Unit.: 4,99" → "4,99". */
const afterLabel = (text: string): string => text.replace(/^[^:]*:\s*/, "").trim();

const clip = (text: string, max: number): string | null => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
};

/** One item from what the page printed; null when description, quantity or amounts are unreadable. */
function toItem(raw: { description: string; code: string; quantity: string; unit: string; unitPrice: string; total: string }): NfceItem | null {
  const description = clip(raw.description, 200);
  const quantity = parseQuantity(raw.quantity);
  if (!description || quantity === null) return null;
  const unitPrice = parseMoney(raw.unitPrice);
  const total = parseMoney(raw.total) ?? (unitPrice === null ? null : lineTotal(quantity, unitPrice));
  if (total === null) return null;
  return {
    description,
    code: clip(raw.code.replace(/^\(?\s*c[óo]d(?:igo)?\.?\s*:?\s*/i, "").replace(/\)\s*$/, ""), 60),
    quantity,
    unit: clip(raw.unit, 12),
    unitPriceCents: unitPrice ?? Math.round(total / quantity),
    totalCents: total,
  };
}

/** The national layout: one `<tr>` per item with the txtTit / Rqtd / RUN / RvlUnit / valor spans. */
function fromSpans(html: string): NfceItem[] {
  const items: NfceItem[] = [];
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const quantity = byClass(row, "Rqtd");
    const description = byClass(row, "txtTit2") ?? byClass(row, "txtTit");
    if (quantity === null || description === null) continue;
    const item = toItem({
      description: textOf(description),
      code: textOf(byClass(row, "RCod") ?? ""),
      quantity: afterLabel(textOf(quantity)),
      unit: afterLabel(textOf(byClass(row, "RUN") ?? "")),
      unitPrice: afterLabel(textOf(byClass(row, "RvlUnit") ?? "")),
      total: textOf(byClass(row, "valor") ?? ""),
    });
    if (item) items.push(item);
  }
  return items;
}

type Column = "code" | "description" | "quantity" | "unit" | "unitPrice" | "total";

/** Which column a header cell names (accents and dots ignored). */
function columnOf(header: string): Column | null {
  const h = header.normalize("NFD").replace(/[̀-ͯ.]/g, "").toLowerCase().trim();
  if (/^(cod|codigo)\b/.test(h)) return "code";
  if (/^(descricao|produto|item descricao)/.test(h)) return "description";
  if (/^(qtd|qtde|quant)/.test(h)) return "quantity";
  if (/^(un|und|unid|unidade)$/.test(h)) return "unit";
  if (/(unit|unitario)/.test(h)) return "unitPrice";
  if (/^(vl|valor)\s*(total|item)?$/.test(h) || /total/.test(h)) return "total";
  return null;
}

/** Cells of a `<tr>`, as text. */
const cellsOf = (row: string): string[] => [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) => textOf(cell));

/** A table with a header row naming description, quantity and total: the items are the rows below it. */
function fromHeaderTable(html: string): NfceItem[] {
  for (const [, table] of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) => cellsOf(row));
    const headerAt = rows.findIndex((cells) => {
      const columns = cells.map(columnOf);
      return columns.includes("description") && columns.includes("quantity") && columns.includes("total");
    });
    if (headerAt === -1) continue;
    const columns = rows[headerAt].map(columnOf);
    const cell = (cells: string[], column: Column): string => cells[columns.indexOf(column)] ?? "";
    const items = rows.slice(headerAt + 1).flatMap((cells) => {
      const item = toItem({
        description: cell(cells, "description"),
        code: cell(cells, "code"),
        quantity: cell(cells, "quantity"),
        unit: cell(cells, "unit"),
        unitPrice: cell(cells, "unitPrice"),
        total: cell(cells, "total"),
      });
      return item ? [item] : [];
    });
    if (items.length > 0) return items;
  }
  return [];
}

/** The items of the note, in order; empty when the page has a layout not known here. */
export function parseNfceItems(html: string): NfceItem[] {
  const spans = fromSpans(html);
  return (spans.length > 0 ? spans : fromHeaderTable(html)).slice(0, MAX_ITEMS);
}

/**
 * The draft the AI read, with the items read from the page in place of its own (they come with every
 * amount, exactly as printed). With no total read, the items' sum stands in for it.
 */
export function withPageItems(draft: PurchaseDraft, items: readonly NfceItem[]): PurchaseDraft {
  if (items.length === 0) return draft;
  const clean = items.map(({ description, quantity, unit, unitPriceCents, totalCents }) => ({ description, quantity, unit, unitPriceCents, totalCents }));
  return { ...draft, items: clean, totalCents: draft.totalCents ?? sumCents(clean.map((i) => i.totalCents)) };
}
