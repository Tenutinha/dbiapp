import "server-only";
import type { TransactionSql } from "postgres";
import { sql } from "../db";
import { supersededParts } from "../storage-parts";

export interface DatasetFile {
  tableName: string;
  storagePath: string;
  rowCount: number;
  sizeBytes: number;
  originalName: string;
  createdAt: Date;
}

export interface VersionRef {
  id: string;
  version: number;
}

export async function createInstance(
  orgId: string, clientId: string | null, templateId: string, name: string,
): Promise<string> {
  // New dashboards go to the end of the space's sidebar.
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO dashboard_instances (organization_id, client_id, template_id, name, position)
    SELECT ${orgId}, ${clientId}, ${templateId}, ${name}, COALESCE(MAX(position), 0) + 1
    FROM dashboard_instances
    WHERE organization_id = ${orgId}
      AND ${clientId === null ? sql`client_id IS NULL` : sql`client_id = ${clientId}`}
    RETURNING id`;
  return row.id;
}

export async function getDraft(instanceId: string): Promise<VersionRef | null> {
  const [row] = await sql<VersionRef[]>`
    SELECT id, version FROM dataset_versions WHERE instance_id = ${instanceId} AND status = 'draft'`;
  return row ?? null;
}

type Tx = TransactionSql;

/**
 * Draft creation, file registration and publish all take this row lock, so they never
 * interleave for the same dashboard (short transactions — no file I/O inside them).
 */
async function lockInstance(tx: Tx, instanceId: string): Promise<void> {
  await tx`SELECT 1 FROM dashboard_instances WHERE id = ${instanceId} FOR UPDATE`;
}

export async function getOrCreateDraft(instanceId: string): Promise<VersionRef> {
  return sql.begin(async (tx) => {
    await lockInstance(tx, instanceId);
    const [existing] = await tx<VersionRef[]>`
      SELECT id, version FROM dataset_versions WHERE instance_id = ${instanceId} AND status = 'draft'`;
    if (existing) return existing;
    const [row] = await tx<VersionRef[]>`
      INSERT INTO dataset_versions (instance_id, version)
      SELECT ${instanceId}, COALESCE(MAX(version), 0) + 1 FROM dataset_versions WHERE instance_id = ${instanceId}
      RETURNING id, version`;
    return row;
  });
}

export async function getVersion(versionId: string): Promise<VersionRef | null> {
  const [row] = await sql<VersionRef[]>`SELECT id, version FROM dataset_versions WHERE id = ${versionId}`;
  return row ?? null;
}

export async function listFiles(versionId: string): Promise<DatasetFile[]> {
  return sql<DatasetFile[]>`
    SELECT table_name AS "tableName", storage_path AS "storagePath", row_count AS "rowCount",
           size_bytes AS "sizeBytes", original_name AS "originalName", created_at AS "createdAt"
    FROM dataset_files WHERE version_id = ${versionId} ORDER BY table_name`.then((rows) =>
    rows.map((r) => ({ ...r, rowCount: Number(r.rowCount), sizeBytes: Number(r.sizeBytes) })),
  );
}

export type DraftFile = Omit<DatasetFile, "createdAt">;

export type RegisterResult =
  | { ok: true; replacedPath: string | null }
  | { ok: false; reason: "not_draft" };

/**
 * Registers a file in a version, only while that version is still the draft.
 * Returns the path it replaced (if any) so the caller can delete the superseded file.
 */
export async function registerDraftFile(instanceId: string, versionId: string, file: DraftFile): Promise<RegisterResult> {
  return sql.begin(async (tx): Promise<RegisterResult> => {
    await lockInstance(tx, instanceId);
    const [version] = await tx<{ status: string }[]>`
      SELECT status FROM dataset_versions WHERE id = ${versionId} AND instance_id = ${instanceId}`;
    if (version?.status !== "draft") return { ok: false, reason: "not_draft" };
    const [previous] = await tx<{ storagePath: string }[]>`
      SELECT storage_path AS "storagePath" FROM dataset_files
      WHERE version_id = ${versionId} AND table_name = ${file.tableName}`;
    await tx`
      INSERT INTO dataset_files (version_id, table_name, storage_path, row_count, size_bytes, original_name)
      VALUES (${versionId}, ${file.tableName}, ${file.storagePath}, ${file.rowCount}, ${file.sizeBytes}, ${file.originalName})
      ON CONFLICT (version_id, table_name) DO UPDATE SET
        storage_path = EXCLUDED.storage_path, row_count = EXCLUDED.row_count,
        size_bytes = EXCLUDED.size_bytes, original_name = EXCLUDED.original_name, created_at = now()`;
    return { ok: true, replacedPath: previous?.storagePath ?? null };
  });
}

export type PromoteResult =
  | { ok: true; superseded: string[] }
  | { ok: false; reason: "draft_changed" | "missing_tables"; tables?: string[] };

/**
 * Atomically promotes the draft to active and archives the previous active version.
 * Tables missing from the draft are carried over from the current active version.
 * Fails if the draft was already published, or if `expectedFiles` no longer matches
 * what is registered (an upload landed after the caller's checks).
 */
export async function promoteDraft(
  instanceId: string,
  draftId: string,
  requiredTables: readonly string[],
  expectedFiles: Readonly<Record<string, string>>,
  report: unknown,
): Promise<PromoteResult> {
  return sql.begin(async (tx): Promise<PromoteResult> => {
    await lockInstance(tx, instanceId);
    const [draft] = await tx<{ status: string }[]>`
      SELECT status FROM dataset_versions WHERE id = ${draftId} AND instance_id = ${instanceId}`;
    if (draft?.status !== "draft") return { ok: false, reason: "draft_changed" };

    const previous = await tx<{ storagePath: string }[]>`
      SELECT f.storage_path AS "storagePath" FROM dataset_files f
      JOIN dashboard_instances i ON i.active_version_id = f.version_id WHERE i.id = ${instanceId}`;

    await tx`
      INSERT INTO dataset_files (version_id, table_name, storage_path, row_count, size_bytes, original_name)
      SELECT ${draftId}, f.table_name, f.storage_path, f.row_count, f.size_bytes, f.original_name
      FROM dataset_files f JOIN dashboard_instances i ON i.active_version_id = f.version_id
      WHERE i.id = ${instanceId}
      ON CONFLICT (version_id, table_name) DO NOTHING`;

    const files = await tx<{ tableName: string; storagePath: string }[]>`
      SELECT table_name AS "tableName", storage_path AS "storagePath" FROM dataset_files WHERE version_id = ${draftId}`;
    const present = new Map(files.map((f) => [f.tableName, f.storagePath]));
    const missing = requiredTables.filter((t) => !present.has(t));
    if (missing.length > 0) return { ok: false, reason: "missing_tables", tables: missing };
    const changed = Object.entries(expectedFiles).some(([table, p]) => present.get(table) !== p);
    if (changed) return { ok: false, reason: "draft_changed" };

    await tx`UPDATE dataset_versions SET status = 'archived'
             WHERE instance_id = ${instanceId} AND status = 'active'`;
    await tx`UPDATE dataset_versions SET status = 'active', published_at = now(), report = ${tx.json(report as never)}
             WHERE id = ${draftId}`;
    await tx`UPDATE dashboard_instances SET active_version_id = ${draftId} WHERE id = ${instanceId}`;
    return { ok: true, superseded: supersededParts(previous.map((p) => p.storagePath), files.map((f) => f.storagePath)) };
  });
}

/**
 * A folder of the bucket moved (a client changed its address): the dashboards' files registered under it
 * now live under `toPrefix`. Both prefixes end with "/", so "clientes/a/" never touches "clientes/ab/".
 * Returns how many tables were updated.
 */
export async function rewriteDatasetPaths(fromPrefix: string, toPrefix: string): Promise<number> {
  if (!fromPrefix.endsWith("/") || !toPrefix.endsWith("/")) throw new Error("folder prefixes must end with /");
  const updated = await sql`
    UPDATE dataset_files SET storage_path = replace(storage_path, ${fromPrefix}, ${toPrefix})
    WHERE strpos(storage_path, ${fromPrefix}) > 0`;
  return updated.count;
}

// ---------- share links ----------

export interface ShareLink {
  id: string;
  token: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export async function listShareLinks(instanceId: string): Promise<ShareLink[]> {
  return sql<ShareLink[]>`
    SELECT id, token, expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"
    FROM share_links WHERE instance_id = ${instanceId} ORDER BY created_at DESC`;
}

export async function createShareLink(
  instanceId: string, userId: string, token: string, expiresAt: Date | null,
): Promise<void> {
  await sql`INSERT INTO share_links (instance_id, token, created_by, expires_at)
            VALUES (${instanceId}, ${token}, ${userId}, ${expiresAt})`;
}

export async function revokeShareLink(instanceId: string, linkId: string): Promise<void> {
  await sql`UPDATE share_links SET revoked_at = now()
            WHERE id = ${linkId} AND instance_id = ${instanceId} AND revoked_at IS NULL`;
}

export interface SharedInstance {
  instanceId: string;
  orgId: string;
  clientId: string | null;
  orgName: string;
  templateId: string;
  name: string;
  activeVersionId: string | null;
  description: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
}

/** Resolves a guest token; null when unknown, revoked or expired. */
export async function resolveShareToken(token: string): Promise<SharedInstance | null> {
  const [row] = await sql<SharedInstance[]>`
    SELECT i.id AS "instanceId", i.organization_id AS "orgId", i.client_id AS "clientId", o.name AS "orgName", i.template_id AS "templateId",
           i.name, i.active_version_id AS "activeVersionId", s.expires_at AS "expiresAt",
           i.description, v.published_at AS "publishedAt"
    FROM share_links s
    JOIN dashboard_instances i ON i.id = s.instance_id
    JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN dataset_versions v ON v.id = i.active_version_id
    WHERE s.token = ${token} AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())
      AND i.archived_at IS NULL`;
  return row ?? null;
}
