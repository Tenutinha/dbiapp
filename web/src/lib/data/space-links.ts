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
/** 42703 = undefined column: migration 019 (link password) is missing. */
const missingColumn = (err: unknown): boolean => (err as { code?: string }).code === "42703";

/** Creating a link with a password before migration 019. */
export class LinkPasswordUnavailableError extends Error {}

export interface OrgSpaceLink extends SpaceLinkRow {
  /** Null for the organization's own space. */
  clientId: string | null;
  /** Asks for a password before opening (migration 019). */
  hasPassword: boolean;
}

export async function listSpaceLinks(orgId: string): Promise<OrgSpaceLink[]> {
  try {
    return await sql<OrgSpaceLink[]>`
      SELECT s.id, s.client_id AS "clientId", s.token, s.expires_at AS "expiresAt", s.revoked_at AS "revokedAt", s.created_at AS "createdAt",
             (to_jsonb(s) ->> 'password_hash') IS NOT NULL AS "hasPassword"
      FROM space_share_links s WHERE s.organization_id = ${orgId} ORDER BY s.created_at DESC`;
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
}

/** Creates the space's link, revoking the one in use (one active link per space). */
export async function createSpaceLink(
  orgId: string, clientId: string | null, userId: string, token: string, expiresAt: Date | null,
  /** Hash of the password (lib/link-password.ts), or null for a link without one. */
  passwordHash: string | null = null,
): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await tx`
        UPDATE space_share_links SET revoked_at = now()
        WHERE organization_id = ${orgId} AND client_id IS NOT DISTINCT FROM ${clientId} AND revoked_at IS NULL`;
      if (passwordHash === null) {
        await tx`
          INSERT INTO space_share_links (organization_id, client_id, token, created_by, expires_at)
          VALUES (${orgId}, ${clientId}, ${token}, ${userId}, ${expiresAt})`;
      } else {
        await tx`
          INSERT INTO space_share_links (organization_id, client_id, token, created_by, expires_at, password_hash)
          VALUES (${orgId}, ${clientId}, ${token}, ${userId}, ${expiresAt}, ${passwordHash})`;
      }
    });
  } catch (err) {
    if (missingTable(err)) throw new SpaceLinksUnavailableError();
    if (missingColumn(err)) throw new LinkPasswordUnavailableError();
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
  linkId: string;
  /** Hash of its password; null when it opens without one. */
  passwordHash: string | null;
  /** Too many wrong passwords: closed until then. */
  lockedUntil: Date | null;
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
      SELECT s.id AS "linkId", to_jsonb(s) ->> 'password_hash' AS "passwordHash",
             (to_jsonb(s) ->> 'locked_until')::timestamptz AS "lockedUntil",
             o.id AS "orgId", o.slug AS "orgSlug", o.name AS "orgName",
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

/**
 * Counts a password attempt on a link: a right one clears the count; after `maxFailures` wrong ones in a
 * row the link is locked for `lockMs`. Returns when it is locked until (null = open).
 */
export async function recordPasswordAttempt(linkId: string, ok: boolean, maxFailures: number, lockMs: number): Promise<Date | null> {
  if (ok) {
    await sql`UPDATE space_share_links SET failed_attempts = 0, locked_until = NULL WHERE id = ${linkId}`;
    return null;
  }
  const [row] = await sql<{ lockedUntil: Date | null }[]>`
    UPDATE space_share_links SET
      failed_attempts = CASE WHEN failed_attempts + 1 >= ${maxFailures} THEN 0 ELSE failed_attempts + 1 END,
      locked_until = CASE WHEN failed_attempts + 1 >= ${maxFailures} THEN now() + make_interval(secs => ${lockMs / 1000}) ELSE locked_until END
    WHERE id = ${linkId}
    RETURNING locked_until AS "lockedUntil"`;
  return row?.lockedUntil ?? null;
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
