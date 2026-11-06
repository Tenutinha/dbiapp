/**
 * Seeds demo organizations, clients and one user per role (used with the dev "entrar como" switcher).
 * Idempotent. Usage: npm run db:seed
 */
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

interface SeedUser {
  email: string;
  name: string;
  org?: "admin" | "editor" | "analyst" | "viewer";
  client?: { slug: string; role: "analyst" | "viewer" };
}

const ODEON_USERS: SeedUser[] = [
  { email: "admin@odeon.local", name: "Ana (admin Odeon)", org: "admin" },
  { email: "dados@odeon.local", name: "Edu (editor Odeon)", org: "editor" },
  { email: "analista@odeon.local", name: "Bia (analista Odeon)", org: "analyst" },
  { email: "joao@cliente1.local", name: "João (leitor Cliente 1)", client: { slug: "cliente1", role: "viewer" } },
  { email: "carla@cliente1.local", name: "Carla (analista Cliente 1)", client: { slug: "cliente1", role: "analyst" } },
  { email: "pedro@cliente2.local", name: "Pedro (leitor Cliente 2)", client: { slug: "cliente2", role: "viewer" } },
];

async function upsertUser(sql: Sql, email: string, name: string): Promise<string> {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (email, name) VALUES (${email}, ${name})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  return u.id;
}

async function upsertOrg(sql: Sql, name: string, slug: string): Promise<string> {
  const [o] = await sql<{ id: string }[]>`
    INSERT INTO organizations (name, slug) VALUES (${name}, ${slug})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  return o.id;
}

async function upsertClient(sql: Sql, orgId: string, name: string, slug: string): Promise<string> {
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO org_clients (organization_id, name, slug) VALUES (${orgId}, ${name}, ${slug})
    ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  return c.id;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const demoEmail = process.env.DBI_DEMO_USER_EMAIL;
  if (!url || !demoEmail) throw new Error("DATABASE_URL and DBI_DEMO_USER_EMAIL must be set");

  const sql = postgres(url, { max: 1 });
  try {
    // Platform owner (you): admin of both demo organizations.
    const demoId = await upsertUser(sql, demoEmail, "Usuário Demo (DBI)");
    const minha = await upsertOrg(sql, "Minha Empresa", "minha-empresa");
    const odeon = await upsertOrg(sql, "Odeon Tecnologia", "odeontecnologia");
    for (const orgId of [minha, odeon]) {
      await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${orgId}, ${demoId}, 'admin')
                ON CONFLICT DO NOTHING`;
    }

    const clients: Record<string, string> = {
      cliente1: await upsertClient(sql, odeon, "Cliente 1", "cliente1"),
      cliente2: await upsertClient(sql, odeon, "Cliente 2", "cliente2"),
    };

    for (const u of ODEON_USERS) {
      const userId = await upsertUser(sql, u.email, u.name);
      if (u.org) {
        await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${odeon}, ${userId}, ${u.org})
                  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
      }
      if (u.client) {
        await sql`INSERT INTO client_members (client_id, user_id, role) VALUES (${clients[u.client.slug]}, ${userId}, ${u.client.role})
                  ON CONFLICT (client_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
      }
    }
    // Admin master (platform administrator), from .env.local — never hard-coded.
    const masterEmail = process.env.DBI_PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
    if (masterEmail) {
      const name = process.env.DBI_PLATFORM_ADMIN_NAME?.trim() || "Admin master";
      await sql`INSERT INTO users (email, name, is_platform_admin) VALUES (${masterEmail}, ${name}, true)
                ON CONFLICT (email) DO UPDATE SET is_platform_admin = true, name = EXCLUDED.name`;
      console.log(`admin master: ${masterEmail}`);
    }

    console.log(`seeded: ${demoEmail} (admin), org /odeontecnologia with /cliente1 and /cliente2, ${ODEON_USERS.length} role users`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
