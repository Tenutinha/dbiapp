import { templateSchema, type Template } from "./schema";

/** Rules for registering dashboards in the catalog. Pure: no I/O, safe to unit test. */

/** Same ceiling as the database CHECK on dashboard_templates.definition. */
export const MAX_TEMPLATE_BYTES = 512 * 1024;
const MAX_ERRORS = 12;

export type ParseResult = { ok: true; template: Template } | { ok: false; errors: string[] };

/** Template JSON (pasted or uploaded) → validated template, or readable errors with their path. */
export function parseTemplateJson(text: string): ParseResult {
  if (!text.trim()) return { ok: false, errors: ["Envie o arquivo template.json ou cole o conteúdo."] };
  if (new TextEncoder().encode(text).length > MAX_TEMPLATE_BYTES) {
    return { ok: false, errors: [`Arquivo grande demais (máximo ${MAX_TEMPLATE_BYTES / 1024} KB).`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`JSON inválido: ${(err as Error).message}`] };
  }
  const parsed = templateSchema.safeParse(raw);
  if (parsed.success) return { ok: true, template: parsed.data };
  const errors = parsed.error.issues.slice(0, MAX_ERRORS).map((i) => {
    const where = i.path.length ? i.path.join(".") : "template";
    return `${where}: ${i.message}`;
  });
  return { ok: false, errors };
}

/**
 * Contract changes that would break data already uploaded by organizations using this dashboard:
 * removed tables, removed columns, changed column types. Layout and measures are safe to change.
 */
export function breakingChanges(current: Template, next: Template): string[] {
  const changes: string[] = [];
  const nextTables = new Map(next.tables.map((t) => [t.name, t]));
  for (const table of current.tables) {
    const after = nextTables.get(table.name);
    if (!after) {
      changes.push(`tabela removida: ${table.name}`);
      continue;
    }
    const afterCols = new Map(after.columns.map((c) => [c.name, c]));
    for (const col of table.columns) {
      const changed = afterCols.get(col.name);
      if (!changed) changes.push(`coluna removida: ${table.name}.${col.name}`);
      else if (changed.type !== col.type) changes.push(`tipo alterado: ${table.name}.${col.name} (${col.type} → ${changed.type})`);
    }
  }
  return changes;
}

/** Whether `next` may replace `current`. Returns the reason it may not, or null. */
export function checkUpdate(current: Template, next: Template): string | null {
  if (next.id !== current.id) {
    return `O identificador ("id") precisa continuar "${current.id}". Para outro dashboard, cadastre um novo.`;
  }
  const same = JSON.stringify(next) === JSON.stringify(current);
  if (!same && next.version <= current.version) {
    return `Aumente a versão ("version") para mais que ${current.version} ao alterar o dashboard.`;
  }
  return null;
}
