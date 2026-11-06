import "server-only";
import { sql } from "../db";
import { storage } from "../storage";

export interface OrgOverview {
  id: string;
  slug: string;
  name: string;
  clients: number;
  dashboards: number;
  people: number;
  createdAt: Date;
}

export async function listAllOrganizations(): Promise<OrgOverview[]> {
  return sql<OrgOverview[]>`
    SELECT o.id, o.slug, o.name, o.created_at AS "createdAt",
      (SELECT COUNT(*)::int FROM org_clients c WHERE c.organization_id = o.id) AS clients,
      (SELECT COUNT(*)::int FROM dashboard_instances i WHERE i.organization_id = o.id) AS dashboards,
      (SELECT COUNT(*)::int FROM (
         SELECT user_id FROM organization_members WHERE organization_id = o.id
         UNION
         SELECT cm.user_id FROM client_members cm JOIN org_clients c ON c.id = cm.client_id WHERE c.organization_id = o.id
       ) p) AS people
    FROM organizations o ORDER BY o.name`;
}

export class DuplicateOrgSlugError extends Error {}

export interface NewOrganization {
  name: string;
  slug: string;
  /** First admin of the organization (created if the e-mail is new). */
  admin: { email: string; name: string } | null;
}

export async function createOrganization(input: NewOrganization): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      const [org] = await tx<{ id: string }[]>`
        INSERT INTO organizations (name, slug) VALUES (${input.name}, ${input.slug}) RETURNING id`;
      if (!input.admin) return;
      const [user] = await tx<{ id: string }[]>`
        INSERT INTO users (email, name) VALUES (${input.admin.email}, ${input.admin.name})
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`;
      await tx`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${org.id}, ${user.id}, 'admin')`;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new DuplicateOrgSlugError(input.slug);
    throw err;
  }
  await storage.createOrgFolder(input.slug);
}
