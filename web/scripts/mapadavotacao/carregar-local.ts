/**
 * SÓ DESENVOLVIMENTO. Monta no banco local a organização Mapa da Votação com um dashboard
 * "eleicoes-presidente" publicado por grupo de cargos, a partir da saída de `npm run mapadavotacao:importar`.
 * Em produção o mesmo é feito pela tela (Catálogo → Adicionar, Dados → Publicar).
 *
 * Uso: npm run mapadavotacao:carregar-local -- <pasta saida do importador>
 * (roda com DBI_STORAGE_DRIVER=local, então nada vai para o bucket.)
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../../src/lib/access";
import { createInstance } from "../../src/lib/data/repository";
import { sql } from "../../src/lib/db";
import { env } from "../../src/lib/env";
import { publishDraft, requireTemplate, uploadTable } from "../../src/lib/services/datasets";

const ORG = { slug: "mapa-da-votacao", name: "Mapa da Votação" };
const TEMPLATE_ID = "eleicoes-presidente";
const SAIDA = path.resolve(process.argv[2] ?? path.join(process.cwd(), "sample-data", "acervo-trabalho", "saida"));

/** Pasta do grupo (saída do importador) → nome do dashboard no sumário. */
const DASHBOARDS: readonly { grupo: string; nome: string }[] = [
  { grupo: "presidente", nome: "Presidente" },
  { grupo: "governador-senador", nome: "Governador e Senador" },
  { grupo: "deputados", nome: "Deputados" },
  { grupo: "prefeito-vereador", nome: "Prefeito e Vereador" },
];

interface Admin { id: string; email: string; name: string }

/** Reaproveita o dashboard de mesmo nome; o primeiro grupo herda o dashboard antigo da Fase 1, se houver. */
async function instanciaDoGrupo(orgId: string, nome: string, primeiro: boolean): Promise<string> {
  const [mesmoNome] = await sql<{ id: string }[]>`
    SELECT id FROM dashboard_instances
    WHERE organization_id = ${orgId} AND client_id IS NULL AND template_id = ${TEMPLATE_ID} AND name = ${nome}`;
  if (mesmoNome) return mesmoNome.id;
  if (primeiro) {
    const nomes = DASHBOARDS.map((d) => d.nome);
    const [antigo] = await sql<{ id: string }[]>`
      SELECT id FROM dashboard_instances
      WHERE organization_id = ${orgId} AND client_id IS NULL AND template_id = ${TEMPLATE_ID} AND name <> ALL(${nomes})
      ORDER BY created_at LIMIT 1`;
    if (antigo) {
      await sql`UPDATE dashboard_instances SET name = ${nome} WHERE id = ${antigo.id}`;
      return antigo.id;
    }
  }
  return createInstance(orgId, null, TEMPLATE_ID, nome);
}

async function publicarGrupo(org: { id: string }, admin: Admin, grupo: string, nome: string, primeiro: boolean): Promise<void> {
  const dir = path.join(SAIDA, grupo);
  if (!existsSync(path.join(dir, "f_votacao.parquet"))) {
    console.log(`${nome}: sem arquivos em ${dir}, pulando`);
    return;
  }
  const template = await requireTemplate(TEMPLATE_ID);
  const instanceId = await instanciaDoGrupo(org.id, nome, primeiro);
  const [inst] = await sql<{ active_version_id: string | null }[]>`
    SELECT active_version_id FROM dashboard_instances WHERE id = ${instanceId}`;
  const access = {
    user: { ...admin, isPlatformAdmin: true },
    org: { id: org.id, slug: ORG.slug, name: ORG.name },
    client: null,
    instanceId,
    templateId: TEMPLATE_ID,
    name: nome,
    activeVersionId: inst.active_version_id,
    description: null,
    publishedAt: null,
  } as unknown as InstanceAccess; // só os campos que uploadTable/publishDraft usam

  for (const table of template.tables) {
    const bytes = await readFile(path.join(dir, `${table.name}.parquet`));
    const report = await uploadTable(access, table.name, new File([bytes], `${table.name}.parquet`));
    if (!report.ok) throw new Error(`${nome} / ${table.name}: ${JSON.stringify(report)}`);
    console.log(`${nome} / ${table.name}: ${report.rowCount.toLocaleString("pt-BR")} linhas`);
  }
  const result = await publishDraft(access);
  if (!result.ok) throw new Error(`${nome}: ${JSON.stringify(result)}`);
  console.log(`${nome}: publicado → /${ORG.slug}/d/${instanceId}`);
}

async function main(): Promise<void> {
  if (env.DBI_STORAGE_DRIVER !== "local") throw new Error("Rode com DBI_STORAGE_DRIVER=local (script só de desenvolvimento).");
  const [org] = await sql<{ id: string }[]>`
    INSERT INTO organizations (name, slug) VALUES (${ORG.name}, ${ORG.slug})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  const [admin] = await sql<Admin[]>`
    SELECT id, email, name FROM users WHERE is_platform_admin ORDER BY created_at LIMIT 1`;
  if (!admin) throw new Error("Nenhum admin da plataforma no banco local (rode npm run db:seed).");

  for (const [i, d] of DASHBOARDS.entries()) await publicarGrupo(org, admin, d.grupo, d.nome, i === 0);
}

main()
  .then(() => sql.end())
  .catch(async (err: unknown) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
