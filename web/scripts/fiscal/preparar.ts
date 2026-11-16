/**
 * Prepara, nesta máquina, os dados de um dashboard fiscal (SPED) a partir de uma pasta de arquivos originais:
 *
 *   1. confere a pasta com o que o armazenamento guarda e envia os originais que faltam (cópia de segurança;
 *      nunca troca nem apaga o que já está lá — diferenças são só relatadas);
 *   2. lê cada arquivo novo ou trocado direto do disco e guarda as partes Parquet na pasta de trabalho local;
 *   3. monta as tabelas do dashboard a partir das partes locais e envia só as tabelas prontas;
 *   4. publica.
 *
 * Uso (em web/, com o .env do ambiente de destino):
 *   node --env-file=<.env> --conditions=react-server --import tsx scripts/fiscal/preparar.ts \
 *     --pasta <pasta dos originais> --molde <id> --org <slug> [--cliente <slug>] \
 *     [--trabalho <pasta de trabalho>] [--so-conferir] [--sem-enviar-originais] [--sem-publicar]
 *
 * O molde do catálogo tem de estar atualizado antes (carregar-fiscal.ts --so-molde, depois do deploy).
 */
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { InstanceAccess } from "../../src/lib/access";
import { isCorrecting, planOriginals, type LocalOriginal } from "../../src/lib/fiscal/originals-plan";
import { readSped } from "../../src/lib/fiscal/sped";
import { fiscalFolder, fiscalNamedKey, fiscalPeriodFolder } from "../../src/lib/storage-keys";

// The modules that read the environment (database, storage) are loaded in main(), after the work folder is set.
type Db = typeof import("../../src/lib/db");
type Fiscal = typeof import("../../src/lib/services/fiscal");

const HEAD_BYTES = 4096;
const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (flag: string): boolean => process.argv.includes(flag);
const mb = (bytes: number): string => `${(bytes / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

async function head(file: string): Promise<Uint8Array> {
  const handle = await open(file, "r");
  try {
    const buffer = new Uint8Array(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Every .txt under the folder that is a file of this SPED, identified by its 0000 record. */
async function localOriginals(folder: string, access: InstanceAccess, importer: ReturnType<Fiscal["requireImporter"]>): Promise<LocalOriginal[]> {
  const found: LocalOriginal[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) await walk(file);
      else if (e.name.toLowerCase().endsWith(".txt")) {
        const bytes = await head(file);
        try {
          const id = importer.identify(bytes);
          const info = await stat(file);
          found.push({
            path: file, cnpj: id.cnpj, periodo: id.periodo, sizeBytes: info.size, modifiedAt: info.mtimeMs,
            correcting: isCorrecting(access.templateId, readSped(bytes)[0]),
          });
        } catch {
          // Not a file of this SPED (another kind, or not a SPED at all): not this dashboard's.
        }
      }
    }
  };
  await walk(folder);
  return found;
}

async function resolveAccess(sql: Db["sql"], templateId: string, orgSlug: string, clientSlug: string | undefined): Promise<InstanceAccess> {
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
      AND template_id = ${templateId} AND archived_at IS NULL ORDER BY created_at LIMIT 1`;
  if (!inst) throw new Error(`nenhum dashboard "${templateId}" ativado nesse espaço`);
  const [admin] = await sql<{ id: string; email: string; name: string }[]>`
    SELECT id, email, name FROM users WHERE is_platform_admin ORDER BY created_at LIMIT 1`;
  if (!admin) throw new Error("nenhum admin da plataforma no banco");
  return {
    user: { ...admin, isPlatformAdmin: true }, org, client, instanceId: inst.id, templateId, name: inst.name,
    activeVersionId: inst.active_version_id, description: null, publishedAt: null,
  } as unknown as InstanceAccess; // só os campos que a montagem e a publicação usam
}

async function main(): Promise<void> {
  const folder = arg("--pasta");
  const templateId = arg("--molde");
  const orgSlug = arg("--org");
  if (!folder || !templateId || !orgSlug) {
    throw new Error("uso: --pasta <pasta> --molde <id> --org <slug> [--cliente <slug>] [--trabalho <pasta>] [--so-conferir] [--sem-enviar-originais] [--sem-publicar]");
  }
  const source = path.resolve(folder);
  // The parts stay on this machine, in a folder that is not temporary; the originals are read from the folder itself.
  process.env.DBI_FISCAL_LOCAL_PARTS = "1";
  process.env.DBI_FISCAL_LOCAL_ORIGINALS = source;
  process.env.DBI_WORK_DIR = path.resolve(arg("--trabalho") ?? process.env.DBI_WORK_DIR ?? path.join(path.dirname(source), ".dbi-preparo"));
  const { sql } = await import("../../src/lib/db");
  closeDb = () => sql.end();
  const { storage } = await import("../../src/lib/storage");
  const { publishDraft, requireTemplate } = await import("../../src/lib/services/datasets");
  const { rawFiles, rebuildFiscal, requireImporter } = await import("../../src/lib/services/fiscal");
  const { spedPartsState } = await import("../../src/lib/services/fiscal-parts");
  if (!storage.remote()) throw new Error("o preparo local serve a um armazenamento na nuvem (DBI_STORAGE_DRIVER=gcs ou supabase)");
  console.log(`pasta de trabalho: ${storage.workRoot}`);

  const access = await resolveAccess(sql, templateId, orgSlug, arg("--cliente"));
  const importer = requireImporter(access);
  if (importer.mode !== "sped") throw new Error(`o molde "${templateId}" não é um SPED`);
  const template = await requireTemplate(templateId);

  // 1. Originals: what the folder has against what the storage keeps.
  const started = Date.now();
  const local = await localOriginals(source, access, importer);
  const stored = await rawFiles(access);
  const plan = planOriginals(local, stored);
  console.log(`originais: ${local.length} na pasta, ${stored.length} no armazenamento; ${plan.inSync} períodos iguais, ${plan.upload.length} a enviar (${mb(plan.upload.reduce((s, f) => s + f.sizeBytes, 0))})`);
  for (const a of plan.ambiguous) console.log(`  aviso: ${a.chosen.cnpj} ${a.chosen.periodo} tem ${a.others.length + 1} versões do mesmo tipo; vai a mais recente: ${a.chosen.path}`);
  for (const o of plan.outdated) console.log(`  aviso: ${o.preferred.cnpj} ${o.preferred.periodo}: o armazenamento guarda outra versão da pasta; a que vale aqui é ${o.preferred.path} (não troquei)`);
  for (const c of plan.conflicts) console.log(`  aviso: ${c.cnpj} ${c.periodo}: o armazenamento guarda um arquivo de ${c.stored.map((s) => s.sizeBytes).join(", ")} bytes que não está na pasta (não troquei)`);
  if (plan.onlyStored.length > 0) console.log(`  aviso: ${plan.onlyStored.length} período(s) só no armazenamento, sem arquivo na pasta`);

  if (!has("--so-conferir") && !has("--sem-enviar-originais")) {
    const target = fiscalFolder(access.org.slug, access.client?.slug || null, templateId);
    let sent = 0;
    for (const file of plan.upload) {
      // The period has no file in the storage (that is why it is sent): the file keeps its own name there.
      const key = fiscalNamedKey(fiscalPeriodFolder(target, file.cnpj, file.periodo), path.basename(file.path), new Set());
      await storage.putFile(key, file.path, "text/plain");
      sent += 1;
      if (sent % 25 === 0 || sent === plan.upload.length) console.log(`  enviados ${sent} de ${plan.upload.length} (${((Date.now() - started) / 60000).toFixed(1)} min)`);
    }
  }

  // 2. What is still to read, as the parts on this machine say.
  const files = await rawFiles(access);
  const state = await spedPartsState(access, importer, template, files);
  console.log(`partes locais: ${state.plan.ready.length} arquivos já lidos, ${state.plan.read.length} a ler (${mb(state.plan.read.reduce((s, f) => s + f.sizeBytes, 0))})`);
  if (has("--so-conferir")) return;

  // 3. Read what is new, put every table together from the local parts, send the tables.
  const reading = Date.now();
  const result = await rebuildFiscal(access, {
    dimensionsFromParts: true,
    by: "script",
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) console.log(`  lidos ${done} de ${total} (${((Date.now() - reading) / 60000).toFixed(1)} min)`);
    },
  });
  console.log(`arquivos no dashboard: ${result.files}: ${result.read ?? 0} lidos agora, ${result.reused ?? 0} já lidos antes, em ${((Date.now() - reading) / 60000).toFixed(1)} min`);
  for (const s of result.skipped) console.log(`  pulado ${s.path}: ${s.error}`);
  for (const table of result.tables) {
    console.log(`  ${table.table}: ${table.ok ? `${table.rowCount.toLocaleString("pt-BR")} linhas, ${mb(table.sizeBytes)}` : `ERRO ${table.errors.join(" | ")}`}`);
  }
  if (!result.ok) throw new Error("as tabelas não passaram na validação; nada foi publicado");
  if (result.skipped.length > 0) throw new Error("há arquivos que não puderam ser lidos; nada foi publicado (rode de novo)");
  if (has("--sem-publicar")) {
    console.log("tabelas no rascunho; não publicado (--sem-publicar)");
    return;
  }

  // 4. Publish.
  const published = await publishDraft(access);
  if (!published.ok) throw new Error(`publicação: ${published.errors.join(" | ")}`);
  for (const o of published.orphans.filter((x) => x.orphans > 0)) console.log(`  aviso: ${o.orphans.toLocaleString("pt-BR")} linhas sem correspondência em ${o.relationship}`);
  console.log(`publicado: /${access.org.slug}/d/${access.instanceId}`);
}

let closeDb: () => Promise<void> = async () => undefined;

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb();
    process.exit(1);
  });
