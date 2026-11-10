import "server-only";
import { sql } from "../db";
import type { SpaceLinkRow } from "../space-link";

/**
 * Public links of whole spaces (migration 014). Reads tolerate a database without the migration (no
 * links, and a token never resolves); creating one says the migration is missing.
 */

export class SpaceLinksUnavailableError extends Error {}

/** 42P01 = undefined table: migration 014 is missing on this database. */
const missingTable = (err: unknown): boolean => (err as { code?: string }).code === "42P01";

export interface OrgSpaceLink extends SpaceLinkRow {
  /** Null for the organization's own space. */
  clientId: string | null;
}

export async function listSpaceLinks(orgId: string): Promise<OrgSpaceLink[]> {
  try {
    return await sql<OrgSpaceLink[]>`
      SELECT id, client_id AS "clientId", token, expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"
      FROM space_share_links WHERE organization_id = ${orgId} ORDER BY created_at DESC`;
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
}

/** Creates the space's link, revoking the one in use (one active link per space). */
export async function createSpaceLink(
  orgId: string, clientId: string | null, userId: string, token: string, expiresAt: Date | null,
): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await tx`
        UPDATE space_share_links SET revoked_at = now()
        WHERE organization_id = ${orgId} AND client_id IS NOT DISTINCT FROM ${clientId} AND revoked_at IS NULL`;
      await tx`
        INSERT INTO space_share_links (organization_id, client_id, token, created_by, expires_at)
        VALUES (${orgId}, ${clientId}, ${token}, ${userId}, ${expiresAt})`;
    });
  } catch (err) {
    if (missingTable(err)) throw new SpaceLinksUnavailableError();
    throw err;
  }
}

/** Revokes the space's active link(s). */
export async function revokeSpaceLinks(orgId: string, clientId: string | null): Promise<void> {
  try {
    await sql`
      UPDATE space_share_links SET revoked_at = now()
      WHERE organization_id = ${orgId} AND client_id IS NOT DISTINCT FROM ${clientId} AND revoked_at IS NULL`;
  } catch (err) {
    if (missingTable(err)) throw new SpaceLinksUnavailableError();
    throw err;
  }
}

export interface ResolvedSpaceLink {
  orgId: string;
  orgSlug: string;
  orgName: string;
  clientId: string | null;
  clientSlug: string | null;
  clientName: string | null;
  expiresAt: Date | null;
}

/** The space a public token opens; null when unknown, revoked or expired. */
export async function resolveSpaceLink(token: string): Promise<ResolvedSpaceLink | null> {
  try {
    const [row] = await sql<ResolvedSpaceLink[]>`
      SELECT o.id AS "orgId", o.slug AS "orgSlug", o.name AS "orgName",
             c.id AS "clientId", c.slug AS "clientSlug", c.name AS "clientName", s.expires_at AS "expiresAt"
      FROM space_share_links s
      JOIN organizations o ON o.id = s.organization_id
      LEFT JOIN org_clients c ON c.id = s.client_id
      WHERE s.token = ${token} AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())`;
    return row ?? null;
  } catch (err) {
    if (missingTable(err)) return null;
    throw err;
  }
}

export interface PublicDashboard {
  instanceId: string;
  templateId: string;
  name: string;
  description: string | null;
  activeVersionId: string;
  publishedAt: Date | null;
}

/** A published, not archived dashboard of exactly this space; null otherwise (a link opens nothing else). */
export async function getPublishedDashboard(orgId: string, clientId: string | null, instanceId: string): Promise<PublicDashboard | null> {
  const [row] = await sql<PublicDashboard[]>`
    SELECT i.id AS "instanceId", i.template_id AS "templateId", i.name, i.description,
           i.active_version_id AS "activeVersionId", v.published_at AS "publishedAt"
    FROM dashboard_instances i
    JOIN dataset_versions v ON v.id = i.active_version_id
    WHERE i.id = ${instanceId} AND i.organization_id = ${orgId}
      AND i.client_id IS NOT DISTINCT FROM ${clientId} AND i.archived_at IS NULL`;
  return row ?? null;
}
