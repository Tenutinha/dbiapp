/**
 * SÓ DESENVOLVIMENTO. Monta no banco local a organização Mapa da Votação com o dashboard
 * "eleicoes-presidente" já publicado, a partir dos Parquets de `npm run mapadavotacao:parquets`.
 * Em produção o mesmo é feito pela tela (Catálogo → Adicionar, Dados → Publicar).
 *
 * Uso: npm run mapadavotacao:carregar-local
 * (roda com DBI_STORAGE_DRIVER=local, então nada vai para o bucket.)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../../src/lib/access";
import { createInstance } from "../../src/lib/data/repository";
import { sql } from "../../src/lib/db";
import { env } from "../../src/lib/env";
import { publishDraft, requireTemplate, uploadTable } from "../../src/lib/services/datasets";

const ORG = { slug: "mapa-da-votacao", name: "Mapa da Votação" };
const TEMPLATE_ID = "eleicoes-presidente";
const DIR = path.join(process.cwd(), "sample-data", TEMPLATE_ID);

async function main(): Promise<void> {
  if (env.DBI_STORAGE_DRIVER !== "local") throw new Error("Rode com DBI_STORAGE_DRIVER=local (script só de desenvolvimento).");
  const template = await requireTemplate(TEMPLATE_ID);

  const [org] = await sql<{ id: string }[]>`
    INSERT INTO organizations (name, slug) VALUES (${ORG.name}, ${ORG.slug})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  const [admin] = await sql<{ id: string; email: string; name: string }[]>`
    SELECT id, email, name FROM users WHERE is_platform_admin ORDER BY created_at LIMIT 1`;
  if (!admin) throw new Error("Nenhum admin da plataforma no banco local (rode npm run db:seed).");

  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM dashboard_instances
    WHERE organization_id = ${org.id} AND client_id IS NULL AND template_id = ${TEMPLATE_ID}`;
  const instanceId = existing?.id ?? (await createInstance(org.id, null, TEMPLATE_ID, template.name));
  const [inst] = await sql<{ active_version_id: string | null }[]>`
    SELECT active_version_id FROM dashboard_instances WHERE id = ${instanceId}`;

  const access = {
    user: { id: admin.id, email: admin.email, name: admin.name, isPlatformAdmin: true },
    org: { id: org.id, slug: ORG.slug, name: ORG.name },
    client: null,
    instanceId,
    templateId: TEMPLATE_ID,
    name: template.name,
    activeVersionId: inst.active_version_id,
    description: null,
    publishedAt: null,
  } as unknown as InstanceAccess; // só os campos que uploadTable/publishDraft usam

  for (const table of template.tables) {
    const file = path.join(DIR, `${table.name}.parquet`);
    const bytes = await readFile(file);
    const report = await uploadTable(access, table.name, new File([bytes], `${table.name}.parquet`));
    if (!report.ok) throw new Error(`${table.name}: ${JSON.stringify(report)}`);
    console.log(`${table.name}: ${report.rowCount?.toLocaleString("pt-BR")} linhas`);
  }
  const result = await publishDraft(access);
  console.log("publicado:", JSON.stringify(result));
  console.log(`Abra /${ORG.slug}/d/${instanceId}`);
}

main()
  .then(() => sql.end())
  .catch(async (err: unknown) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
