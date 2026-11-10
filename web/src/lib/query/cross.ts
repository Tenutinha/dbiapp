/**
 * Cross-filtering, Power BI style: picking an item in a chart or table filters every *other* visual by
 * it, while the visual that was clicked keeps all its items and highlights the picked ones.
 *
 * The selection lives in the URL as `x.<visualId>.<fieldId>=value` (ids are snake_case, so the dots
 * split cleanly). Pure: used by the server (parsing, SQL) and by the browser (clicks).
 */
import type { Template, Visual } from "../templates/schema";

export interface CrossEntry {
  /** Visual the values were picked in: it is the one that does not get filtered by them. */
  visualId: string;
  fieldId: string;
  values: readonly string[];
}

export type CrossSelection = readonly CrossEntry[];

/** One clicked value (a bar, a slice, an area, or each grouped column of a table row). */
export interface CrossPick {
  fieldId: string;
  value: string;
}

export const CROSS_PREFIX = "x.";
const MAX_VALUES = 200;
const MAX_VALUE_LENGTH = 200;

export function crossKey(visualId: string, fieldId: string): string {
  return `${CROSS_PREFIX}${visualId}.${fieldId}`;
}

/** Fields a click on this visual selects by (none for KPIs, raw listings and texts). */
export function crossFields(visual: Visual): string[] {
  switch (visual.type) {
    case "bar":
    case "line":
    case "donut":
    case "map":
      return [visual.field];
    case "table":
      return [...visual.fields];
    default:
      return [];
  }
}

/** Reads the `x.<visual>.<field>` search params that point to a real visual and one of its fields. */
export function parseCross(
  template: Template,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): CrossSelection {
  const known = new Set(template.fields.map((f) => f.id));
  const entries: CrossEntry[] = [];
  for (const visual of template.visuals) {
    for (const fieldId of crossFields(visual)) {
      if (!known.has(fieldId)) continue;
      const raw = searchParams[crossKey(visual.id, fieldId)];
      const values = (Array.isArray(raw) ? raw : raw ? [raw] : [])
        .slice(0, MAX_VALUES)
        .map((v) => v.slice(0, MAX_VALUE_LENGTH));
      if (values.length > 0) entries.push({ visualId: visual.id, fieldId, values: [...new Set(values)] });
    }
  }
  return entries;
}

/** What is picked in one visual, per field. */
export function ownCross(params: URLSearchParams, visualId: string, fields: readonly string[]): Record<string, string[]> {
  return Object.fromEntries(fields.map((f) => [f, params.getAll(crossKey(visualId, f))]));
}

export function hasCross(params: URLSearchParams): boolean {
  return [...params.keys()].some((k) => k.startsWith(CROSS_PREFIX));
}

/** Same params without any cross selection. */
export function clearCross(params: URLSearchParams): URLSearchParams {
  return new URLSearchParams([...params.entries()].filter(([k]) => !k.startsWith(CROSS_PREFIX)));
}

/**
 * Search params after a click.
 *  - plain click: the clicked item becomes the only selection of the page (clicking the only selected
 *    item again clears it);
 *  - additive (Ctrl/Cmd/Shift + click): the item is added to, or taken from, what is already picked.
 */
export function toggleCross(
  params: URLSearchParams, visualId: string, picks: readonly CrossPick[], additive: boolean,
): URLSearchParams {
  if (picks.length === 0) return new URLSearchParams(params);
  const own = ownCross(params, visualId, picks.map((p) => p.fieldId));
  const selected = picks.every((p) => own[p.fieldId].includes(p.value));

  if (!additive) {
    const next = clearCross(params);
    const onlyOne = selected && picks.every((p) => own[p.fieldId].length === 1);
    if (!onlyOne) picks.forEach((p) => next.append(crossKey(visualId, p.fieldId), p.value));
    return next;
  }

  const next = new URLSearchParams(params);
  for (const p of picks) {
    const key = crossKey(visualId, p.fieldId);
    const values = selected ? own[p.fieldId].filter((v) => v !== p.value) : [...new Set([...own[p.fieldId], p.value])];
    next.delete(key);
    values.forEach((v) => next.append(key, v));
  }
  return next;
}

/** A row (its value per field) is highlighted when every field with a selection includes the row's value. */
export function isPicked(own: Readonly<Record<string, readonly string[]>>, row: Readonly<Record<string, string>>): boolean {
  const active = Object.entries(own).filter(([, values]) => values.length > 0);
  return active.length > 0 && active.every(([fieldId, values]) => values.includes(row[fieldId]));
}
