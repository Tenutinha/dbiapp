/**
 * Tables whose first column the reader can swap (`fieldChoices`, like a Power BI field parameter). The
 * choice lives in the URL as `d.<visualId>=<fieldId>`; the template is resolved against it before the
 * queries run, so the queries, the cross-filtering and the drawing all see one plain table. Pure: used by
 * the server (loading) and by the browser (the picker).
 */
import type { Template, Visual } from "./schema";

export const CHOICE_PREFIX = "d.";

export function choiceKey(visualId: string): string {
  return `${CHOICE_PREFIX}${visualId}`;
}

type TableVisual = Extract<Visual, { type: "table" }>;
type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function pickedField(visual: TableVisual, searchParams: SearchParams): string | undefined {
  const raw = searchParams[choiceKey(visual.id)];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && visual.fieldChoices?.includes(value) ? value : undefined;
}

/** The table as the reader asked for it: its first field swapped, and its measures that do not fit it left out. */
export function resolveTable(visual: TableVisual, searchParams: SearchParams): TableVisual {
  const picked = pickedField(visual, searchParams);
  const fields = picked === undefined ? visual.fields : [picked, ...visual.fields.slice(1)];
  const onlyWith = visual.onlyWith ?? {};
  const fits = (measure: string): boolean => {
    const needs = onlyWith[measure];
    return needs === undefined || needs.some((f) => fields.includes(f));
  };
  const measures = visual.measures.filter(fits);
  if (picked === undefined && measures.length === visual.measures.length) return visual;
  const orderBy = visual.orderBy && measures.includes(visual.orderBy) ? visual.orderBy : undefined;
  const leading = visual.leading?.filter((m) => measures.includes(m));
  return { ...visual, fields, measures, orderBy, leading };
}

/** The template with every swappable table resolved against the page's search params (a new object; the input is untouched). */
export function withChosenFields(template: Template, searchParams: SearchParams): Template {
  if (!template.visuals.some((v) => v.type === "table" && (v.fieldChoices || v.onlyWith))) return template;
  return {
    ...template,
    visuals: template.visuals.map((v) => (v.type === "table" ? resolveTable(v, searchParams) : v)),
  };
}

/**
 * Search params after the reader picks another field: the choice is set and the items picked in that
 * table go, since they were values of the other field.
 */
export function chooseField(params: URLSearchParams, visualId: string, fieldId: string): URLSearchParams {
  const crossOfVisual = `x.${visualId}.`;
  const next = new URLSearchParams([...params.entries()].filter(([k]) => !k.startsWith(crossOfVisual) && k !== choiceKey(visualId)));
  next.set(choiceKey(visualId), fieldId);
  return next;
}
