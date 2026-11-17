import { CROSS_PREFIX } from "./query/cross";
import { CHOICE_PREFIX } from "./templates/field-choice";

/** What a dashboard reads from the address: its filters, the items picked in its visuals and the fields chosen for its tables. */
const SELECTION_PREFIXES = ["f.", CROSS_PREFIX, CHOICE_PREFIX];

/**
 * The selection of a dashboard (filters, picked items, chosen fields) as one query string in a stable order:
 * the names sorted, each one's values in the order they came. It tells one selection from another, and the
 * server (which gets the params as a record) and the browser (as a URLSearchParams) must write the same
 * string for the same selection. Anything else in the address (which dashboard of a shared space is open,
 * a tracking code) is not part of it: pages differ in what they pass on, and it changes no number. Pure.
 */
export function canonicalSearch(entries: Iterable<readonly [string, string]>): string {
  const byName = new Map<string, string[]>();
  for (const [name, value] of entries) {
    if (SELECTION_PREFIXES.some((prefix) => name.startsWith(prefix))) byName.set(name, [...(byName.get(name) ?? []), value]);
  }
  const query = new URLSearchParams();
  for (const name of [...byName.keys()].sort()) {
    for (const value of byName.get(name) ?? []) query.append(name, value);
  }
  return query.toString();
}

/** The same string from the record a page (server) receives its search params as. */
export function canonicalSearchOf(searchParams: Readonly<Record<string, string | string[] | undefined>>): string {
  return canonicalSearch(
    Object.entries(searchParams).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((v) => [name, v] as const),
    ),
  );
}

/** A query string back as the record a page receives ("f.mes=a&f.mes=b" → { "f.mes": ["a", "b"] }). */
export function searchRecord(search: string): Record<string, string | string[]> {
  // Gathered in a Map: a name like "__proto__" or "constructor" is only a name there.
  const byName = new Map<string, string[]>();
  for (const [name, value] of new URLSearchParams(search)) byName.set(name, [...(byName.get(name) ?? []), value]);
  return Object.fromEntries([...byName].map(([name, values]) => [name, values.length === 1 ? values[0] : values]));
}
