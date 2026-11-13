/**
 * Monta e publica um dashboard fiscal a partir dos arquivos brutos já guardados no armazenamento — o mesmo
 * que o botão "Montar tabelas" + "Publicar" da tela, para volumes que não cabem numa requisição (ex.: uma
 * ECD com milhões de lançamentos).
 *
 *   1. atualiza o molde no catálogo com web/fiscal-templates/<molde>.json (só se ainda for rascunho);
 *   2. organiza os arquivos soltos na pasta do espaço e põe as tabelas no rascunho — nos SPED, só os arquivos
 *      novos ou trocados são lidos; os outros vêm das partes já lidas (services/fiscal-parts.ts);
 *   3. publica.
 *
 * Uso (em web/, com o .env do ambiente de destino):
 *   node --env-file=<.env> --conditions=react-server --import tsx scripts/fiscal/carregar-fiscal.ts \
 *     --molde <id> --org <slug> [--cliente <slug>] [--so-molde] [--so-blocos] [--reler-tudo]
 *
 * Arquivos lidos ao mesmo tempo: DBI_FISCAL_READ_CONCURRENCY (padrão 1; 6 vai bem numa carga de milhares de arquivos).
 *
 * Com --so-blocos, a fato principal fica como está publicada; só as tabelas por bloco (ex.: bloco_a_servicos)
 * e as dimensões entram no rascunho. Com --reler-tudo, todos os arquivos são lidos de novo.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../../src/lib/access";
import { findTemplate, updateDefinition } from "../../src/lib/data/catalog";
import { sql } from "../../src/lib/db";
import { publishDraft } from "../../src/lib/services/datasets";
import { rebuildFiscal } from "../../src/lib/services/fiscal";
import { extraFacts, templateSchema, type Template } from "../../src/lib/templates/schema";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/**
 * JSON of a value with the keys of every object in a fixed order. The database keeps a definition as jsonb,
 * which returns keys in an order of its own: maps such as a table's `source.derive` come back reordered,
 * and a plain comparison would take the same contract for a different one.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

/** The file's template with the summary and the hidden analyses the catalog has (when it has a readable one). */
function keepStructure(fromFile: Template, stored: unknown): Template {
  const current = templateSchema.safeParse(stored);
  if (!current.success || current.data.summary.length === 0) return fromFile;
  const known = new Set(fromFile.analyses.map((a) => a.id));
  const hidden = new Set(current.data.analyses.filter((a) => a.hidden).map((a) => a.id));
  const summary = current.data.summary
    .map((g) => ({ ...g, analyses: g.analyses.filter((id) => known.has(id)) }))
    .filter((g) => g.analyses.length > 0);
  if (summary.length === 0) return fromFile;
  if (JSON.stringify(summary) !== JSON.stringify(fromFile.summary)) {
    console.log(`catálogo: sumário mantido como está na tela (${summary.flatMap((g) => g.analyses).join(", ")})`);
  }
  return templateSchema.parse({
    ...fromFile,
    summary,
    analyses: fromFile.analyses.map((a) => (hidden.has(a.id) ? { ...a, hidden: true } : a)),
  });
}

async function main(): Promise<void> {
  const templateId = arg("--molde");
  const orgSlug = arg("--org");
  const clientSlug = arg("--cliente");
  if (!templateId || !orgSlug) throw new Error("uso: --molde <id> --org <slug> [--cliente <slug>] [--so-molde]");

  const fromFile = templateSchema.parse(JSON.parse(await readFile(path.join(process.cwd(), "fiscal-templates", `${templateId}.json`), "utf8")));
  const existing = await findTemplate(fromFile.id);
  if (!existing) throw new Error(`o molde "${fromFile.id}" não está no catálogo`);
  // The structure people see (which analyses are in the summary, which are off the air) is edited on the
  // screen and belongs to the catalog: the file brings tables, fields, measures and visuals, never that.
  const t = keepStructure(fromFile, existing.definition);
  if (canonical(templateSchema.parse(existing.definition)) === canonical(t)) {
    console.log(`catálogo: "${t.id}" já está atualizado`);
  } else {
    if (existing.builtIn) throw new Error(`o molde "${t.id}" é embutido; atualize pelo arquivo em web/templates`);
    // Um molde publicado só muda por aqui enquanto nenhum dashboard feito dele tem dados (o contrato pode mudar à vontade).
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM dataset_versions v JOIN dashboard_instances i ON i.id = v.instance_id WHERE i.template_id = ${t.id}`;
    // With data in place, only what does not touch the contract (visuals, fields, measures, sections) may change here.
    const current = templateSchema.parse(existing.definition);
    // New extra facts (e.g. bloco_a_servicos) do not touch what is published: a dashboard goes on without them until they are loaded.
    const added = new Set(extraFacts(t).map((tb) => tb.name).filter((name) => !current.tables.some((tb) => tb.name === name)));
    const sameContract = canonical([current.tables, current.relationships])
      === canonical([t.tables.filter((tb) => !added.has(tb.name)), t.relationships]);
    if (existing.status !== "draft" && n > 0 && !sameContract) {
      throw new Error(`o molde "${t.id}" está ${existing.status} e já tem dashboards com dados; atualize pela tela`);
    }
    await updateDefinition(t);
    console.log(`catálogo: molde "${t.id}" (${existing.status}) atualizado (${t.visuals.length} visuais)`);
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
  const result = await rebuildFiscal(access, {
    ...(process.argv.includes("--so-blocos") ? { only: "blocks" as const } : {}),
    rereadAll: process.argv.includes("--reler-tudo"),
    // A line every 25 files, so a long load shows where it is.
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`  lidos ${done} de ${total} (${((Date.now() - started) / 60000).toFixed(1)} min)`);
    },
  });
  const how = result.read !== undefined ? `: ${result.read} lidos agora, ${result.reused ?? 0} já lidos antes` : "";
  console.log(`arquivos no dashboard: ${result.files}${how} (${result.adopted} organizados da pasta do espaço) em ${((Date.now() - started) / 1000).toFixed(0)} s`);
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
