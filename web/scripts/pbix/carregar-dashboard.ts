/**
 * Cadastra um template convertido de .pbix (skill pbix-importar) e o liga a uma organização:
 *   1. grava o template no catálogo como RASCUNHO (fica fora da vitrine das outras organizações);
 *   2. cria o dashboard no espaço do cliente (ou reaproveita o de mesmo nome);
 *   3. sobe cada tabela pelo mesmo caminho da tela (uploadTable → ingest → storage) e publica.
 *
 * Uso (em web/, com o .env do ambiente de destino):
 *   node --env-file=<.env> --conditions=react-server --import tsx scripts/pbix/carregar-dashboard.ts \
 *     --template <template.json> --dados <pasta com <tabela>.parquet> --org <slug> [--cliente <slug>] [--nome "<nome>"]
 * Só com --template (sem --org), apenas grava o template no catálogo como rascunho.
 * Com --org e sem --dados, ativa o dashboard no espaço, vazio (os dados entram depois pela tela).
 * Com --pasta <pasta da organização> em vez de --dados, lê as tabelas de lá, no armazenamento (bucket),
 * como o "Importar pasta" da tela (ex.: --pasta clientes/araguaia/provimento/guias/preparado).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../../src/lib/access";
import { findTemplate, insertTemplate, updateDefinition } from "../../src/lib/data/catalog";
import { createInstance } from "../../src/lib/data/repository";
import { sql } from "../../src/lib/db";
import { publishDraft, uploadTable } from "../../src/lib/services/datasets";
import { importFolder } from "../../src/lib/services/storage-import";
import { templateSchema, type Template } from "../../src/lib/templates/schema";

interface Args {
  template: string;
  /** Pasta local com <tabela>.parquet. */
  dados?: string;
  /** Pasta da organização no armazenamento (relativa a orgs/<slug>/) com <tabela>.parquet. */
  pasta?: string;
  /** Sem organização, só grava o template no catálogo (rascunho). */
  org?: string;
  cliente?: string;
  nome?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const template = get("--template");
  const dados = get("--dados");
  const org = get("--org");
  const pasta = get("--pasta");
  if (!template) {
    throw new Error("uso: --template <arquivo> [--org <slug> [--cliente <slug>] [--nome <nome>] [--dados <pasta local> | --pasta <pasta no armazenamento>]]");
  }
  if (dados && pasta) throw new Error("use --dados (pasta local) ou --pasta (armazenamento), não os dois");
  return { template, dados, pasta, org, cliente: get("--cliente"), nome: get("--nome") };
}

interface Org { id: string; slug: string; name: string }
interface Client { id: string; slug: string; name: string }
interface Admin { id: string; email: string; name: string }

async function loadAdmin(): Promise<Admin> {
  const [admin] = await sql<Admin[]>`SELECT id, email, name FROM users WHERE is_platform_admin ORDER BY created_at LIMIT 1`;
  if (!admin) throw new Error("nenhum admin da plataforma no banco");
  return admin;
}

async function loadTargets(a: Args & { org: string }): Promise<{ org: Org; client: Client | null; admin: Admin }> {
  const [org] = await sql<Org[]>`SELECT id, slug, name FROM organizations WHERE slug = ${a.org}`;
  if (!org) throw new Error(`organização "${a.org}" não existe`);
  let client: Client | null = null;
  if (a.cliente) {
    [client] = await sql<Client[]>`
      SELECT id, slug, name FROM org_clients WHERE organization_id = ${org.id} AND slug = ${a.cliente}`;
    if (!client) throw new Error(`cliente "${a.cliente}" não existe na organização ${org.slug}`);
  }
  return { org, client, admin: await loadAdmin() };
}

/**
 * Grava o template como rascunho. Se já existir: igual → reaproveita; ainda rascunho (e não embutido) →
 * atualiza; publicado ou embutido → recusa, pois a mudança tem de passar pela tela (checagem de contrato).
 */
async function registerTemplate(t: Template, adminId: string): Promise<void> {
  const existing = await findTemplate(t.id);
  if (!existing) {
    await insertTemplate(t, "draft", adminId);
    console.log(`catálogo: "${t.id}" cadastrado como rascunho`);
    return;
  }
  if (JSON.stringify(templateSchema.parse(existing.definition)) === JSON.stringify(t)) {
    console.log(`catálogo: "${t.id}" já existe (igual), reaproveitado`);
    return;
  }
  if (existing.status !== "draft" || existing.builtIn) {
    throw new Error(`já existe um template "${t.id}" ${existing.status} diferente; edite-o pela tela ou troque o id`);
  }
  await updateDefinition(t);
  console.log(`catálogo: rascunho "${t.id}" atualizado`);
}

async function ensureInstance(org: Org, client: Client | null, t: Template, name: string): Promise<string> {
  const [same] = await sql<{ id: string }[]>`
    SELECT id FROM dashboard_instances
    WHERE organization_id = ${org.id} AND client_id IS NOT DISTINCT FROM ${client?.id ?? null}
      AND template_id = ${t.id} AND name = ${name} AND archived_at IS NULL`;
  if (same) return same.id;
  return createInstance(org.id, client?.id ?? null, t.id, name);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t = templateSchema.parse(JSON.parse(await readFile(args.template, "utf8")));
  if (!args.org) {
    await registerTemplate(t, (await loadAdmin()).id);
    return;
  }
  const { org, client, admin } = await loadTargets({ ...args, org: args.org });
  const name = args.nome ?? t.name;

  await registerTemplate(t, admin.id);
  const instanceId = await ensureInstance(org, client, t, name);
  if (!args.dados && !args.pasta) {
    console.log(`ativado sem dados${client ? ` no espaço ${client.name}` : ""}: /${org.slug}/d/${instanceId}/dados`);
    return;
  }
  const [inst] = await sql<{ active_version_id: string | null }[]>`
    SELECT active_version_id FROM dashboard_instances WHERE id = ${instanceId}`;
  const access = {
    user: { ...admin, isPlatformAdmin: true },
    org,
    client,
    instanceId,
    templateId: t.id,
    name,
    activeVersionId: inst.active_version_id,
    description: null,
    publishedAt: null,
  } as unknown as InstanceAccess; // só os campos que uploadTable/publishDraft usam

  if (args.pasta) {
    const imported = await importFolder(access, args.pasta);
    if (imported.missing.length > 0) throw new Error(`faltam na pasta ${args.pasta}: ${imported.missing.join(", ")}`);
    for (const report of imported.reports) {
      if (!report.ok) throw new Error(`${report.table}: ${JSON.stringify(report)}`);
      console.log(`dados (${args.pasta}): ${report.table}: ${report.rowCount.toLocaleString("pt-BR")} linhas`);
    }
  } else {
    for (const table of t.tables) {
      const bytes = await readFile(path.join(args.dados as string, `${table.name}.parquet`));
      const report = await uploadTable(access, table.name, new File([bytes], `${table.name}.parquet`));
      if (!report.ok) throw new Error(`${table.name}: ${JSON.stringify(report)}`);
      console.log(`dados: ${table.name}: ${report.rowCount.toLocaleString("pt-BR")} linhas`);
    }
  }
  const result = await publishDraft(access);
  if (!result.ok) throw new Error(`publicação: ${JSON.stringify(result)}`);
  console.log(`publicado${client ? ` no espaço ${client.name}` : ""}: /${org.slug}/d/${instanceId}`);
}

main()
  .then(() => sql.end())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await sql.end();
    process.exit(1);
  });
