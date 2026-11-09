/**
 * Monta e publica um dashboard fiscal a partir dos arquivos brutos já guardados no armazenamento — o mesmo
 * que o botão "Montar tabelas" + "Publicar" da tela, para volumes que não cabem numa requisição (ex.: uma
 * ECD com milhões de lançamentos).
 *
 *   1. atualiza o molde no catálogo com web/fiscal-templates/<molde>.json (só se ainda for rascunho);
 *   2. organiza os arquivos soltos na pasta do espaço, lê todos e põe as tabelas no rascunho;
 *   3. publica.
 *
 * Uso (em web/, com o .env do ambiente de destino):
 *   node --env-file=<.env> --conditions=react-server --import tsx scripts/fiscal/carregar-fiscal.ts \
 *     --molde <id> --org <slug> [--cliente <slug>] [--so-molde]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../../src/lib/access";
import { findTemplate, updateDefinition } from "../../src/lib/data/catalog";
import { sql } from "../../src/lib/db";
import { publishDraft } from "../../src/lib/services/datasets";
import { rebuildFiscal } from "../../src/lib/services/fiscal";
import { templateSchema } from "../../src/lib/templates/schema";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const templateId = arg("--molde");
  const orgSlug = arg("--org");
  const clientSlug = arg("--cliente");
  if (!templateId || !orgSlug) throw new Error("uso: --molde <id> --org <slug> [--cliente <slug>] [--so-molde]");

  const t = templateSchema.parse(JSON.parse(await readFile(path.join(process.cwd(), "fiscal-templates", `${templateId}.json`), "utf8")));
  const existing = await findTemplate(t.id);
  if (!existing) throw new Error(`o molde "${t.id}" não está no catálogo`);
  if (JSON.stringify(templateSchema.parse(existing.definition)) === JSON.stringify(t)) {
    console.log(`catálogo: "${t.id}" já está atualizado`);
  } else {
    if (existing.status !== "draft" || existing.builtIn) throw new Error(`o molde "${t.id}" está ${existing.status}; atualize pela tela`);
    await updateDefinition(t);
    console.log(`catálogo: rascunho "${t.id}" atualizado (${t.visuals.length} visuais)`);
  }
  if (process.argv.includes("--so-molde")) return;

  const [org] = await sql<{ id: string; slug: string; name: string }[]>`SELECT id, slug, name FROM organizations WHERE slug = ${orgSlug}`;
  if (!org) throw new Error(`organização "${orgSlug}" não existe`);
  let client: { id: string; slug: string; name: string } | null = null;
  if (clientSlug) {
    [client] = await sql<{ id: string; slug: string; name: string }[]>`
      SELECT id, slug, name FROM org_clients WHERE organization_id = ${org.id} AND slug = ${clientSlug}`;
    if (!client) throw new Error(`cliente "${clientSlug}" não existe em ${org.slug}`);
  }
  const [inst] = await sql<{ id: string; name: string; active_version_id: string | null }[]>`
    SELECT id, name, active_version_id FROM dashboard_instances
    WHERE organization_id = ${org.id} AND client_id IS NOT DISTINCT FROM ${client?.id ?? null}
      AND template_id = ${t.id} AND archived_at IS NULL ORDER BY created_at LIMIT 1`;
  if (!inst) throw new Error(`nenhum dashboard "${t.id}" ativado nesse espaço`);
  const [admin] = await sql<{ id: string; email: string; name: string }[]>`
    SELECT id, email, name FROM users WHERE is_platform_admin ORDER BY created_at LIMIT 1`;
  if (!admin) throw new Error("nenhum admin da plataforma no banco");

  const access = {
    user: { ...admin, isPlatformAdmin: true },
    org,
    client,
    instanceId: inst.id,
    templateId: t.id,
    name: inst.name,
    activeVersionId: inst.active_version_id,
    description: null,
    publishedAt: null,
  } as unknown as InstanceAccess; // só os campos que rebuildFiscal/publishDraft usam

  const started = Date.now();
  const result = await rebuildFiscal(access);
  console.log(`arquivos lidos: ${result.files} (${result.adopted} organizados da pasta do espaço) em ${((Date.now() - started) / 1000).toFixed(0)} s`);
  for (const s of result.skipped) console.log(`  pulado ${s.path}: ${s.error}`);
  for (const table of result.tables) {
    console.log(`  ${table.table}: ${table.ok ? `${table.rowCount.toLocaleString("pt-BR")} linhas, ${(table.sizeBytes / 1024 ** 2).toFixed(1)} MB` : `ERRO ${table.errors.join(" | ")}`}`);
  }
  if (!result.ok) throw new Error("as tabelas não passaram na validação; nada foi publicado");

  const published = await publishDraft(access);
  if (!published.ok) throw new Error(`publicação: ${published.errors.join(" | ")}`);
  for (const o of published.orphans.filter((x) => x.orphans > 0)) console.log(`  aviso: ${o.orphans.toLocaleString("pt-BR")} linhas sem correspondência em ${o.relationship}`);
  console.log(`publicado: /${org.slug}/d/${inst.id}`);
}

main()
  .then(() => sql.end())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await sql.end();
    process.exit(1);
  });
