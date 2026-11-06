import "server-only";
import { sql } from "../db";
import type { Template } from "../templates/schema";

/** Catalog repository: the dashboard_templates table (see 007_dashboard_catalog.sql). */

export const TEMPLATE_STATUSES = ["draft", "published", "archived"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export interface CatalogRow {
  id: string;
  name: string;
  area: string;
  origin: Template["origin"];
  description: string;
  version: number;
  status: TemplateStatus;
  builtIn: boolean;
  /** Dashboards activated from this template, across all organizations. */
  usage: number;
  updatedAt: Date;
}

export interface StoredTemplate {
  definition: unknown;
  status: TemplateStatus;
  builtIn: boolean;
}

export class DuplicateTemplateError extends Error {}

const metaColumns = (t: Template) => ({
  id: t.id,
  name: t.name,
  area: t.area,
  origin: t.origin,
  description: t.description,
  version: t.version,
});

export async function listCatalog(onlyStatus?: TemplateStatus): Promise<CatalogRow[]> {
  return sql<CatalogRow[]>`
    SELECT t.id, t.name, t.area, t.origin, t.description, t.version, t.status,
           t.built_in AS "builtIn", t.updated_at AS "updatedAt",
           (SELECT COUNT(*)::int FROM dashboard_instances i WHERE i.template_id = t.id) AS usage
    FROM dashboard_templates t
    ${onlyStatus ? sql`WHERE t.status = ${onlyStatus}` : sql``}
    ORDER BY t.area, t.name`;
}

export async function findTemplate(id: string): Promise<StoredTemplate | null> {
  const [row] = await sql<StoredTemplate[]>`
    SELECT definition, status, built_in AS "builtIn" FROM dashboard_templates WHERE id = ${id}`;
  return row ?? null;
}

export async function listDefinitions(onlyStatus: TemplateStatus): Promise<unknown[]> {
  const rows = await sql<{ definition: unknown }[]>`
    SELECT definition FROM dashboard_templates WHERE status = ${onlyStatus} ORDER BY area, name`;
  return rows.map((r) => r.definition);
}

export async function insertTemplate(t: Template, status: TemplateStatus, createdBy: string): Promise<void> {
  const m = metaColumns(t);
  try {
    await sql`
      INSERT INTO dashboard_templates (id, name, area, origin, description, version, definition, status, created_by)
      VALUES (${m.id}, ${m.name}, ${m.area}, ${m.origin}, ${m.description}, ${m.version}, ${sql.json(t as never)}, ${status}, ${createdBy})`;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new DuplicateTemplateError(t.id);
    throw err;
  }
}

/**
 * Replaces the definition of a template. Built-in ones may be edited too: they stay built in,
 * so a file in web/templates with a higher version still takes over on the next sync.
 */
export async function updateDefinition(t: Template): Promise<void> {
  const m = metaColumns(t);
  await sql`
    UPDATE dashboard_templates
    SET name = ${m.name}, area = ${m.area}, origin = ${m.origin}, description = ${m.description},
        version = ${m.version}, definition = ${sql.json(t as never)}, updated_at = now()
    WHERE id = ${m.id}`;
}

export async function setStatus(id: string, status: TemplateStatus): Promise<void> {
  await sql`UPDATE dashboard_templates SET status = ${status}, updated_at = now() WHERE id = ${id}`;
}

/** Deletes a template nobody uses. Returns false when it is in use or built in. */
export async function deleteUnusedTemplate(id: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM dashboard_templates t
    WHERE t.id = ${id} AND NOT t.built_in
      AND NOT EXISTS (SELECT 1 FROM dashboard_instances i WHERE i.template_id = t.id)
    RETURNING t.id`;
  return rows.length > 0;
}

/**
 * Templates shipped in web/templates: inserted as published the first time, and their definition
 * refreshed when the file has a higher version. Status chosen by an admin is never overwritten.
 */
export async function syncBuiltIns(templates: readonly Template[]): Promise<void> {
  for (const t of templates) {
    const m = metaColumns(t);
    await sql`
      INSERT INTO dashboard_templates (id, name, area, origin, description, version, definition, status, built_in)
      VALUES (${m.id}, ${m.name}, ${m.area}, ${m.origin}, ${m.description}, ${m.version}, ${sql.json(t as never)}, 'published', true)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, area = EXCLUDED.area, origin = EXCLUDED.origin, description = EXCLUDED.description,
          version = EXCLUDED.version, definition = EXCLUDED.definition, updated_at = now()
      WHERE dashboard_templates.built_in AND dashboard_templates.version < EXCLUDED.version`;
  }
}
