import "server-only";
import { sql } from "../db";
import type { LogoMime } from "../theme/logo";
import { ROLE_LABEL, type Role } from "../permissions";

/** Public URL of an avatar by its unguessable id (null = no avatar: show initials). */
export const avatarUrl = (key: string | null | undefined): string | null => (key ? `/api/users/avatar/${key}` : null);

/** The database has no avatar columns yet (migration 012 missing). */
export class AvatarUnavailableError extends Error {}

/** Sets (or clears, with null) the user's avatar. Returns the previous file path so it can be deleted. */
export async function setUserAvatar(
  userId: string,
  avatar: { key: string; path: string; mime: LogoMime } | null,
): Promise<string | null> {
  try {
    const [row] = await sql<{ previous: string | null }[]>`
      UPDATE users u SET avatar_key = ${avatar?.key ?? null}, avatar_path = ${avatar?.path ?? null},
                         avatar_mime = ${avatar?.mime ?? null}
      FROM (SELECT id, avatar_path FROM users WHERE id = ${userId}) old
      WHERE u.id = old.id
      RETURNING old.avatar_path AS previous`;
    return row?.previous ?? null;
  } catch (err) {
    // 42703 = undefined column: migration 012 is missing on this database.
    if ((err as { code?: string }).code === "42703") throw new AvatarUnavailableError();
    throw err;
  }
}

/** Avatar file by its public id (works, returning null, before migration 012). */
export async function findAvatar(key: string): Promise<{ path: string; mime: LogoMime } | null> {
  const [row] = await sql<{ path: string | null; mime: LogoMime | null }[]>`
    SELECT to_jsonb(u) ->> 'avatar_path' AS path, to_jsonb(u) ->> 'avatar_mime' AS mime
    FROM users u WHERE to_jsonb(u) ->> 'avatar_key' = ${key}`;
  return row?.path && row.mime ? { path: row.path, mime: row.mime } : null;
}

export interface ProfileMembership {
  /** Organization or client name, e.g. "Mapa da Votação" or "Mapa da Votação › fernando". */
  space: string;
  href: string;
  role: string;
}

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  createdAt: Date;
  memberships: ProfileMembership[];
}

/** What "Meu perfil" shows: who the person is and where they have access. */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const [user] = await sql<{ name: string; email: string; avatarKey: string | null; isPlatformAdmin: boolean; createdAt: Date }[]>`
    SELECT name, email, to_jsonb(u) ->> 'avatar_key' AS "avatarKey", is_platform_admin AS "isPlatformAdmin",
           created_at AS "createdAt"
    FROM users u WHERE id = ${userId}`;
  if (!user) return null;
  const rows = await sql<{ orgName: string; orgSlug: string; clientName: string | null; clientSlug: string | null; role: string }[]>`
    SELECT o.name AS "orgName", o.slug AS "orgSlug", NULL AS "clientName", NULL AS "clientSlug", m.role::text AS role
    FROM organization_members m JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = ${userId}
    UNION ALL
    SELECT o.name, o.slug, c.name, c.slug, cm.role::text
    FROM client_members cm JOIN org_clients c ON c.id = cm.client_id JOIN organizations o ON o.id = c.organization_id
    WHERE cm.user_id = ${userId}
    ORDER BY 1, 3 NULLS FIRST`;
  return {
    name: user.name,
    email: user.email,
    avatarUrl: avatarUrl(user.avatarKey),
    isPlatformAdmin: user.isPlatformAdmin,
    createdAt: user.createdAt,
    memberships: rows.map((r) => ({
      space: r.clientName ? `${r.orgName} › ${r.clientName}` : r.orgName,
      href: r.clientSlug ? `/${r.orgSlug}/${r.clientSlug}` : `/${r.orgSlug}`,
      role: ROLE_LABEL[r.role as Role] ?? r.role,
    })),
  };
}
