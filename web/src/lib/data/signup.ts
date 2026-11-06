import "server-only";
import { sql } from "../db";
import { storage } from "../storage";
import { slugCandidates, type SignupMetadata } from "../login";

const SLUG_ATTEMPTS = 20;

export interface ProvisionedAccount {
  userId: string;
  /** Address of the organization created now; null when the person already had an account. */
  orgSlug: string | null;
}

/**
 * First confirmed sign-in of a self-service signup: creates the person, their organization and
 * makes them its admin — all or nothing. Safe to call twice (concurrent requests included): an
 * advisory lock per e-mail serializes them and the second one finds the user already there.
 * If the wanted address is taken, the first free variant (odeon-2, odeon-3…) is used.
 */
export async function provisionSelfSignup(email: string, meta: SignupMetadata): Promise<ProvisionedAccount> {
  for (let attempt = 1; ; attempt++) {
    try {
      const account = await provisionOnce(email, meta);
      if (account.orgSlug) await storage.createOrgFolder(account.orgSlug);
      return account;
    } catch (err) {
      // Another signup grabbed the same free address a moment earlier: pick again.
      const uniqueViolation = (err as { code?: string }).code === "23505";
      if (!uniqueViolation || attempt >= 3) throw err;
    }
  }
}

async function provisionOnce(email: string, meta: SignupMetadata): Promise<ProvisionedAccount> {
  const normalized = email.toLowerCase();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`signup:${normalized}`}))`;
    const [existing] = await tx<{ id: string }[]>`SELECT id FROM users WHERE email = ${normalized}`;
    if (existing) return { userId: existing.id, orgSlug: null };

    const candidates = slugCandidates(meta.slug, SLUG_ATTEMPTS);
    const taken = await tx<{ slug: string }[]>`SELECT slug FROM organizations WHERE slug IN ${tx(candidates)}`;
    const takenSet = new Set(taken.map((t) => t.slug));
    const slug = candidates.find((c) => !takenSet.has(c));
    if (!slug) throw new Error(`no free organization address for "${meta.slug}"`);

    const [org] = await tx<{ id: string }[]>`
      INSERT INTO organizations (name, slug) VALUES (${meta.orgName}, ${slug}) RETURNING id`;
    const [user] = await tx<{ id: string }[]>`
      INSERT INTO users (email, name) VALUES (${normalized}, ${meta.name}) RETURNING id`;
    await tx`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${org.id}, ${user.id}, 'admin')`;
    return { userId: user.id, orgSlug: slug };
  });
}

/** Whether an organization already uses this address (used to warn on the signup form). */
export async function isOrgSlugTaken(slug: string): Promise<boolean> {
  const [row] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM organizations WHERE slug = ${slug}`;
  return (row?.n ?? 0) > 0;
}
