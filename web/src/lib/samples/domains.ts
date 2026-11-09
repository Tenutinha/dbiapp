/**
 * Values a template expects to find in its columns, read from its own expressions: a measure such as
 * `SUM(votos) FILTER (WHERE turno = 2)` only shows something when the sample has rows with turno 2.
 */
import type { Template } from "../templates/schema";

/** "table.column" → the literal values the template compares that column with, most relevant first. */
export type LiteralDomains = ReadonlyMap<string, readonly string[]>;

const REF = "(?:\\b([a-z_][a-z0-9_]*)\\.)?\\b([a-z_][a-z0-9_]*)";
const VALUE = "'([^']*)'|(-?\\d+(?:\\.\\d+)?)";

type Found = readonly [table: string | undefined, column: string, values: readonly string[]];

const valuesIn = (text: string, prefix = ""): string[] =>
  [...text.matchAll(new RegExp(`${prefix}(?:${VALUE})`, "gi"))].map((m) => m[1] ?? m[2]);

function comparisons(sql: string): Found[] {
  const equal = [...sql.matchAll(new RegExp(`${REF}\\s*(?:=|<>|!=)\\s*(?:${VALUE})`, "gi"))].map(
    (m): Found => [m[1], m[2], [m[3] ?? m[4]]],
  );
  const inList = [...sql.matchAll(new RegExp(`${REF}\\s+(?:NOT\\s+)?IN\\s*\\(([^)]*)\\)`, "gi"))].map(
    (m): Found => [m[1], m[2], valuesIn(m[3])],
  );
  const caseOf = [...sql.matchAll(new RegExp(`\\bCASE\\s+${REF}\\s+(WHEN\\b[\\s\\S]*?)\\bEND\\b`, "gi"))].map(
    (m): Found => [m[1], m[2], valuesIn(m[3], "WHEN\\s+")],
  );
  return [...equal, ...inList, ...caseOf];
}

function resolver(template: Template): (table: string | undefined, column: string) => string | null {
  const ordered = [...template.tables].sort((a, b) => Number(b.kind === "fact") - Number(a.kind === "fact"));
  return (table, column) => {
    const name = column.toLowerCase();
    const owner = ordered.find(
      (t) => (table === undefined || t.name === table.toLowerCase()) && t.columns.some((c) => c.name === name),
    );
    return owner ? `${owner.name}.${name}` : null;
  };
}

/** Values of the single-choice filters whose field is a plain column ("2026, 2024"). */
function defaults(template: Template): Found[] {
  return Object.entries(template.filterDefaults).flatMap(([fieldId, preferred]): Found[] => {
    const sql = template.fields.find((f) => f.id === fieldId)?.sql.trim() ?? "";
    const plain = new RegExp(`^${REF}$`, "i").exec(sql);
    const values = preferred.split(",").map((v) => v.trim()).filter(Boolean);
    return plain ? [[plain[1], plain[2], values]] : [];
  });
}

export function literalDomains(template: Template): LiteralDomains {
  const resolve = resolver(template);
  const expressions = [...template.fields, ...template.measures].map((e) => e.sql);
  const found = [...defaults(template), ...expressions.flatMap(comparisons)];
  return found.reduce((acc, [table, column, values]) => {
    const key = resolve(table, column);
    if (!key || values.length === 0) return acc;
    const merged = [...new Set([...(acc.get(key) ?? []), ...values])];
    return new Map([...acc, [key, merged]]);
  }, new Map<string, readonly string[]>());
}
