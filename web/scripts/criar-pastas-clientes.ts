/**
 * Cria a pasta de cada cliente já cadastrado (orgs/<org>/clientes/<cliente>/) no armazenamento.
 * Clientes novos ganham a pasta ao serem criados; este script cobre os que já existiam.
 * Idempotente: pastas que já existem ficam como estão.
 *
 * Uso (em web/): node --env-file=<.env> --conditions=react-server --import tsx scripts/criar-pastas-clientes.ts
 */
import { sql } from "../src/lib/db";
import { storage } from "../src/lib/storage";
import { clientFolder } from "../src/lib/storage-keys";

async function main(): Promise<void> {
  const rows = await sql<{ org: string; client: string }[]>`
    SELECT o.slug AS org, c.slug AS client FROM org_clients c JOIN organizations o ON o.id = c.organization_id ORDER BY 1, 2`;
  for (const r of rows) {
    await storage.createClientFolder(r.org, r.client);
    console.log(`ok  ${clientFolder(r.org, r.client)}`);
  }
  console.log(`${rows.length} pasta(s) de cliente conferida(s).`);
}

main()
  .then(() => sql.end())
  .catch(async (err: unknown) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
