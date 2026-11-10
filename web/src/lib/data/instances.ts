import "server-only";
import { sql } from "../db";

/** A dashboard linked to the organization or to one of its clients, as the administration lists it. */
export interface AdminDashboardRow {
  id: string;
  name: string;
  templateId: string;
  /** Null for the organization's own space. */
  clientId: string | null;
  clientName: string | null;
  published: boolean;
  publishedAt: Date | null;
  /** Files uploaded but not published yet. */
  hasDraft: boolean;
}

export async function listOrgDashboards(orgId: string): Promise<AdminDashboardRow[]> {
  return sql<AdminDashboardRow[]>`
    SELECT i.id, i.name, i.template_id AS "templateId", i.client_id AS "clientId", c.name AS "clientName",
           (i.active_version_id IS NOT NULL) AS published, v.published_at AS "publishedAt",
           EXISTS (SELECT 1 FROM dataset_versions d WHERE d.instance_id = i.id AND d.status = 'draft') AS "hasDraft"
    FROM dashboard_instances i
    LEFT JOIN org_clients c ON c.id = i.client_id
    LEFT JOIN dataset_versions v ON v.id = i.active_version_id
    WHERE i.organization_id = ${orgId} AND i.archived_at IS NULL
    ORDER BY c.name NULLS FIRST, i.position, i.created_at`;
}

export interface LinkResult {
  id: string;
  /** "restored": the same dashboard had been unlinked from this space; its data came back. */
  outcome: "created" | "restored" | "already-linked";
}

/**
 * Links a catalog dashboard to a space (the organization, or one client). Linking a dashboard that
 * was unlinked from the same space brings back that one, with its data, instead of a new empty one.
 */
export async function linkDashboard(
  orgId: string,
  clientId: string | null,
  templateId: string,
  name: string,
): Promise<LinkResult> {
  return sql.begin(async (tx): Promise<LinkResult> => {
    // Serialise links per organization so two clicks never create two copies.
    await tx`SELECT 1 FROM organizations WHERE id = ${orgId} FOR UPDATE`;
    const space = clientId === null ? tx`client_id IS NULL` : tx`client_id = ${clientId}`;
    const existing = await tx<{ id: string; archived: boolean }[]>`
      SELECT id, (archived_at IS NOT NULL) AS archived FROM dashboard_instances
      WHERE organization_id = ${orgId} AND ${space} AND template_id = ${templateId}
      ORDER BY (archived_at IS NULL) DESC, archived_at DESC NULLS LAST, created_at DESC`;

    const linked = existing.find((e) => !e.archived);
    if (linked) return { id: linked.id, outcome: "already-linked" };

    const nextPosition = tx`(SELECT COALESCE(MAX(position), 0) + 1 FROM dashboard_instances
                             WHERE organization_id = ${orgId} AND ${space} AND archived_at IS NULL)`;
    const archived = existing[0];
    if (archived) {
      await tx`UPDATE dashboard_instances SET archived_at = NULL, position = ${nextPosition} WHERE id = ${archived.id}`;
      return { id: archived.id, outcome: "restored" };
    }

    const [row] = await tx<{ id: string }[]>`
      INSERT INTO dashboard_instances (organization_id, client_id, template_id, name, position)
      VALUES (${orgId}, ${clientId}, ${templateId}, ${name}, ${nextPosition})
      RETURNING id`;
    return { id: row.id, outcome: "created" };
  });
}

/** Unlinks (archives) a dashboard: hidden everywhere, data kept for a later re-link. */
export async function archiveDashboard(instanceId: string): Promise<void> {
  await sql`UPDATE dashboard_instances SET archived_at = now(), section_id = NULL
            WHERE id = ${instanceId} AND archived_at IS NULL`;
}

/** A data file that feeds (or is about to feed) a linked dashboard. */
export interface FileInUse {
  instanceId: string;
  dashboardName: string;
  clientName: string | null;
  version: number;
  /** "active" = what the dashboard shows now; "draft" = uploaded, waiting to be published. */
  status: "active" | "draft";
  tableName: string;
  originalName: string;
  rowCount: number;
  sizeBytes: number;
  storagePath: string;
  createdAt: Date;
}

export async function listFilesInUse(orgId: string): Promise<FileInUse[]> {
  return sql<FileInUse[]>`
    SELECT i.id AS "instanceId", i.name AS "dashboardName", c.name AS "clientName",
           v.version, v.status::text AS status, f.table_name AS "tableName", f.original_name AS "originalName",
           f.row_count::float8 AS "rowCount", f.size_bytes::float8 AS "sizeBytes",
           f.storage_path AS "storagePath", f.created_at AS "createdAt"
    FROM dashboard_instances i
    JOIN dataset_versions v ON v.instance_id = i.id AND v.status IN ('active', 'draft')
    JOIN dataset_files f ON f.version_id = v.id
    LEFT JOIN org_clients c ON c.id = i.client_id
    WHERE i.organization_id = ${orgId} AND i.archived_at IS NULL
    ORDER BY c.name NULLS FIRST, i.position, i.name, v.status, f.table_name`;
}

/** Every file name engaged by the organization's dashboards (active or draft), with the space it belongs to — the explorer's "Usado em". */
export async function listFileUses(orgId: string): Promise<{ file: string; clientSlug: string | null; dashboard: string; state: "active" | "draft" }[]> {
  return sql<{ file: string; clientSlug: string | null; dashboard: string; state: "active" | "draft" }[]>`
    SELECT DISTINCT f.original_name AS file, c.slug AS "clientSlug", i.name AS dashboard, v.status::text AS state
    FROM dashboard_instances i
    JOIN dataset_versions v ON v.instance_id = i.id AND v.status IN ('active', 'draft')
    JOIN dataset_files f ON f.version_id = v.id
    LEFT JOIN org_clients c ON c.id = i.client_id
    WHERE i.organization_id = ${orgId} AND i.archived_at IS NULL`;
}

/**
 * The dashboard's data filter as stored (validated later against the fact table). Read through
 * to_jsonb so it also works on a database where migration 010 has not run yet (then: no filter).
 */
export async function getDataFilterRaw(instanceId: string): Promise<unknown> {
  const [row] = await sql<{ filter: unknown }[]>`
    SELECT to_jsonb(i) -> 'data_filter' AS filter FROM dashboard_instances i WHERE i.id = ${instanceId}`;
  return row?.filter ?? [];
}

export class DataFilterUnavailableError extends Error {}

/** Saves an already validated data filter. */
export async function setDataFilter(instanceId: string, filter: readonly unknown[]): Promise<void> {
  try {
    await sql`UPDATE dashboard_instances SET data_filter = ${sql.json(filter as never)} WHERE id = ${instanceId}`;
  } catch (err) {
    // 42703 = undefined column: migration 010 is missing on this database.
    if ((err as { code?: string }).code === "42703") throw new DataFilterUnavailableError();
    throw err;
  }
}
