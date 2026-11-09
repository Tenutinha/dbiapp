import "server-only";
import { sql } from "../db";
import type { ClientRef } from "../access";
import type { ClientRole, Role } from "../permissions";

export interface ClientSummary extends ClientRef {
  dashboards: number;
  users: number;
}

export async function listClients(orgId: string): Promise<ClientSummary[]> {
  return sql<ClientSummary[]>`
    SELECT c.id, c.slug, c.name,
      (SELECT COUNT(*)::int FROM dashboard_instances i WHERE i.client_id = c.id AND i.archived_at IS NULL) AS dashboards,
      (SELECT COUNT(*)::int FROM client_members m WHERE m.client_id = c.id) AS users
    FROM org_clients c WHERE c.organization_id = ${orgId} ORDER BY c.name`;
}

export class DuplicateSlugError extends Error {}

export async function createClient(orgId: string, name: string, slug: string): Promise<void> {
  try {
    await sql`INSERT INTO org_clients (organization_id, name, slug) VALUES (${orgId}, ${name}, ${slug})`;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new DuplicateSlugError(slug);
    throw err;
  }
}

/** Every person with access to the organization, with their staff role and client roles. */
export interface OrgPerson {
  userId: string;
  email: string;
  name: string;
  orgRole: Role | null;
  clients: { clientId: string; clientName: string; role: ClientRole }[];
}

export async function listOrgPeople(orgId: string): Promise<OrgPerson[]> {
  const rows = await sql<{
    userId: string; email: string; name: string; orgRole: Role | null;
    clientId: string | null; clientName: string | null; clientRole: ClientRole | null;
  }[]>`
    WITH people AS (
      SELECT user_id FROM organization_members WHERE organization_id = ${orgId}
      UNION
      SELECT cm.user_id FROM client_members cm JOIN org_clients c ON c.id = cm.client_id
      WHERE c.organization_id = ${orgId}
    )
    SELECT u.id AS "userId", u.email, u.name, om.role AS "orgRole",
           c.id AS "clientId", c.name AS "clientName", cm.role AS "clientRole"
    FROM people p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN organization_members om ON om.user_id = u.id AND om.organization_id = ${orgId}
    LEFT JOIN client_members cm ON cm.user_id = u.id
      AND cm.client_id IN (SELECT id FROM org_clients WHERE organization_id = ${orgId})
    LEFT JOIN org_clients c ON c.id = cm.client_id
    ORDER BY u.name, c.name`;

  const byUser = new Map<string, OrgPerson>();
  for (const r of rows) {
    const person = byUser.get(r.userId) ?? {
      userId: r.userId, email: r.email, name: r.name, orgRole: r.orgRole, clients: [],
    };
    const clients = r.clientId && r.clientName && r.clientRole
      ? [...person.clients, { clientId: r.clientId, clientName: r.clientName, role: r.clientRole }]
      : person.clients;
    byUser.set(r.userId, { ...person, clients });
  }
  return [...byUser.values()];
}

/** Finds the user by e-mail or creates it (no invitation e-mails yet). */
async function upsertUser(email: string, name: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, name) VALUES (${email}, ${name})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id`;
  return user.id;
}

export interface AccessGrant {
  email: string;
  name: string;
  /** null = organization staff; otherwise the client (must belong to orgId). */
  clientId: string | null;
  role: Role;
}

export async function grantAccess(orgId: string, grant: AccessGrant): Promise<void> {
  const userId = await upsertUser(grant.email, grant.name);
  if (grant.clientId === null) {
    await sql`
      INSERT INTO organization_members (organization_id, user_id, role) VALUES (${orgId}, ${userId}, ${grant.role})
      ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
    return;
  }
  const inserted = await sql`
    INSERT INTO client_members (client_id, user_id, role)
    SELECT c.id, ${userId}, ${grant.role} FROM org_clients c
    WHERE c.id = ${grant.clientId} AND c.organization_id = ${orgId}
    ON CONFLICT (client_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
  if (inserted.count === 0) throw new Error("client does not belong to organization");
}

export async function revokeOrgRole(orgId: string, userId: string): Promise<void> {
  await sql`DELETE FROM organization_members WHERE organization_id = ${orgId} AND user_id = ${userId}`;
}

export async function revokeClientRole(orgId: string, clientId: string, userId: string): Promise<void> {
  await sql`
    DELETE FROM client_members cm USING org_clients c
    WHERE cm.client_id = c.id AND c.organization_id = ${orgId}
      AND cm.client_id = ${clientId} AND cm.user_id = ${userId}`;
}

export async function countAdmins(orgId: string): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM organization_members WHERE organization_id = ${orgId} AND role = 'admin'`;
  return n;
}
