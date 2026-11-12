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
  /** Dashboards in use (not archived) made from this template, across all organizations. */
  usage: number;
  /** Where it is used: every dashboard made from it, archived ones included (they go with a deletion). */
  uses: TemplateUse[];
  updatedAt: Date;
}

export interface TemplateUse {
  org: string;
  /** Null for the organization's own space. */
  client: string | null;
  dashboard: string;
  archived: boolean;
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
           (SELECT COUNT(*)::int FROM dashboard_instances i WHERE i.template_id = t.id AND i.archived_at IS NULL) AS usage,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('org', o.name, 'client', c.name, 'dashboard', i.name, 'archived', i.archived_at IS NOT NULL)
                              ORDER BY i.archived_at IS NOT NULL, o.name, c.name)
             FROM dashboard_instances i
             JOIN organizations o ON o.id = i.organization_id
             LEFT JOIN org_clients c ON c.id = i.client_id
             WHERE i.template_id = t.id
           ), '[]'::jsonb) AS uses
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

/**
 * Deletes a template no dashboard in use depends on: the archived dashboards made from it go too (their
 * versions and links cascade). Returns the storage paths of their data files, to delete after, or null
 * when it is still in use or built in.
 */
export async function deleteUnusedTemplate(id: string): Promise<string[] | null> {
  return sql.begin(async (tx): Promise<string[] | null> => {
    const [template] = await tx<{ builtIn: boolean; active: number }[]>`
      SELECT t.built_in AS "builtIn",
             (SELECT COUNT(*)::int FROM dashboard_instances i WHERE i.template_id = t.id AND i.archived_at IS NULL) AS active
      FROM dashboard_templates t WHERE t.id = ${id} FOR UPDATE`;
    if (!template || template.builtIn || template.active > 0) return null;
    const files = await tx<{ storagePath: string }[]>`
      SELECT f.storage_path AS "storagePath" FROM dataset_files f
      JOIN dataset_versions v ON v.id = f.version_id
      JOIN dashboard_instances i ON i.id = v.instance_id
      WHERE i.template_id = ${id}`;
    await tx`DELETE FROM dashboard_instances WHERE template_id = ${id} AND archived_at IS NOT NULL`;
    await tx`DELETE FROM dashboard_templates WHERE id = ${id}`;
    return files.map((f) => f.storagePath);
  });
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
