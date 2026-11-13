/**
 * Junta, para a Auditoria fiscal de um espaço, o que ela lê dos arquivos fiscais já guardados:
 *
 *   <saída>/contrib_c/<cnpj>-<aaaa-mm>.parquet   C010, C100 e C170 de cada EFD Contribuições, linha a linha
 *   <saída>/icms_registros.parquet               fato "registros" publicada do dashboard EFD ICMS/IPI
 *   <saída>/nfe_itens_<n>.parquet                fato "nfe_itens" publicada do dashboard NF-e (uma por parte)
 *
 * Os arquivos brutos são baixados um a um e apagados depois de lidos; um arquivo já extraído não é lido de
 * novo (apague o Parquet dele para forçar). Depois rode preparar.py com AUDITORIA_ENTRADA=<saída>.
 *
 * Uso (em web/, com o .env do ambiente):
 *   node --env-file=<.env> --conditions=react-server --import tsx scripts/fiscal/auditoria/extrair.ts \
 *     --org <slug> [--cliente <slug>] --saida <pasta> [--desde <aaaa-mm>]
 *
 * Com --desde, só os meses a partir dele (para testar, ou para quem só quer auditar um período).
 */
import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { queryRows, toDuckPath, withConnection } from "../../../src/lib/duck/engine";
import { csvLine } from "../../../src/lib/fiscal/csv";
import { factColumns, spedKindFor, type SpedKind } from "../../../src/lib/fiscal/sped-kinds";
import { appendSpedFile, writeChunk } from "../../../src/lib/fiscal/sped-stream";
import { sql } from "../../../src/lib/db";
import { storage } from "../../../src/lib/storage";
import { fiscalFolder } from "../../../src/lib/storage-keys";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Só o bloco C, e dele só o estabelecimento, as notas e os itens. */
const TABLE = "auditoria_bloco_c";
function blocoC(kind: SpedKind): SpedKind {
  return { ...kind, blockFacts: { [TABLE]: { blocks: ["C"], only: ["C010", "C100", "C170"] } } };
}

interface Space { orgId: string; orgSlug: string; clientId: string | null; clientSlug: string | null }

async function space(orgSlug: string, clientSlug: string | undefined): Promise<Space> {
  const [org] = await sql<{ id: string }[]>`SELECT id FROM organizations WHERE slug = ${orgSlug}`;
  if (!org) throw new Error(`organização "${orgSlug}" não existe`);
  if (!clientSlug) return { orgId: org.id, orgSlug, clientId: null, clientSlug: null };
  const [client] = await sql<{ id: string }[]>`SELECT id FROM org_clients WHERE organization_id = ${org.id} AND slug = ${clientSlug}`;
  if (!client) throw new Error(`cliente "${clientSlug}" não existe em ${orgSlug}`);
  return { orgId: org.id, orgSlug, clientId: client.id, clientSlug };
}

/** Os .txt da EFD Contribuições guardados no espaço: <pasta fiscal>/<cnpj>/<aaaa-mm>/<arquivo>. */
async function rawContrib(s: Space): Promise<{ key: string; cnpj: string; periodo: string }[]> {
  const base = fiscalFolder(s.orgSlug, s.clientSlug, "efd-contribuicoes").replace(/^orgs\/[^/]+\//, "").replace(/\/$/, "");
  const files: { key: string; cnpj: string; periodo: string }[] = [];
  for (const cnpj of (await storage.listOrgFolder(s.orgSlug, base)).folders) {
    for (const periodo of (await storage.listOrgFolder(s.orgSlug, `${base}/${cnpj}`)).folders) {
      const listed = await storage.listOrgFolder(s.orgSlug, `${base}/${cnpj}/${periodo}`);
      for (const f of listed.files.filter((x) => x.name.toLowerCase().endsWith(".txt"))) files.push({ key: f.key, cnpj, periodo });
    }
  }
  return files.sort((a, b) => a.periodo.localeCompare(b.periodo) || a.key.localeCompare(b.key));
}

async function extractContrib(s: Space, outDir: string): Promise<void> {
  const kind = spedKindFor("efd-contribuicoes");
  if (!kind) throw new Error("leitor da EFD Contribuições não encontrado");
  const reader = blocoC(kind);
  const dir = path.join(outDir, "contrib_c");
  await mkdir(dir, { recursive: true });
  const since = arg("--desde") ?? "";
  const files = (await rawContrib(s)).filter((f) => f.periodo >= since);
  console.log(`EFD Contribuições: ${files.length} arquivos no espaço`);
  for (const [i, f] of files.entries()) {
    // Mais de um arquivo no mesmo mês (retificadora ao lado da original): o nome leva o índice.
    const target = path.join(dir, `${f.cnpj}-${f.periodo}-${i}.parquet`);
    if (existsSync(target)) continue;
    const local = await storage.localPath(f.key);
    const csv = path.join(dir, `_${i}.csv`);
    try {
      const out = createWriteStream(csv, { encoding: "utf8" });
      await writeChunk(out, csvLine(factColumns(kind)));
      const read = await appendSpedFile(reader, local, { fact: null, blocks: { [TABLE]: out } });
      out.end();
      await once(out, "close");
      await withConnection(path.resolve(dir), async (conn) => {
        await queryRows(conn, `COPY (SELECT * REPLACE (CAST(periodo AS DATE) AS periodo, CAST(linha AS BIGINT) AS linha)
          FROM read_csv('${toDuckPath(csv)}', header = true, all_varchar = true))
          TO '${toDuckPath(target)}' (FORMAT parquet)`, []);
      });
      console.log(`  ${i + 1}/${files.length} ${f.cnpj} ${f.periodo}: ${(read.blockLines[TABLE] ?? 0).toLocaleString("pt-BR")} linhas`);
    } finally {
      await rm(csv, { force: true });
      if (storage.remote()) await rm(local, { force: true });
    }
  }
}

/** Os Parquets publicados de uma tabela de um dashboard do espaço. */
async function published(s: Space, templateId: string, table: string): Promise<string[]> {
  const rows = await sql<{ storage_path: string }[]>`
    SELECT f.storage_path FROM dashboard_instances i JOIN dataset_files f ON f.version_id = i.active_version_id
    WHERE i.organization_id = ${s.orgId} AND i.client_id IS NOT DISTINCT FROM ${s.clientId}
      AND i.template_id = ${templateId} AND i.archived_at IS NULL AND f.table_name = ${table}`;
  return rows.flatMap((r) => r.storage_path.split("\n").filter(Boolean));
}

async function copyPublished(s: Space, templateId: string, table: string, outDir: string, name: string): Promise<void> {
  const keys = await published(s, templateId, table);
  if (keys.length === 0) {
    console.log(`${templateId}: sem dashboard publicado no espaço (a auditoria segue sem ele)`);
    return;
  }
  for (const [i, key] of keys.entries()) {
    const target = path.join(outDir, keys.length > 1 || name === "nfe_itens" ? `${name}_${i}.parquet` : `${name}.parquet`);
    await copyFile(await storage.localPath(key), target);
  }
  console.log(`${templateId}: ${keys.length} arquivo(s) de ${table}`);
}

async function main(): Promise<void> {
  const orgSlug = arg("--org");
  const outDir = arg("--saida");
  if (!orgSlug || !outDir) throw new Error("uso: extrair.ts --org <slug> [--cliente <slug>] --saida <pasta>");
  const s = await space(orgSlug, arg("--cliente"));
  await mkdir(outDir, { recursive: true });
  await copyPublished(s, "efd-icms-ipi", "registros", outDir, "icms_registros");
  await copyPublished(s, "nfe", "nfe_itens", outDir, "nfe_itens");
  await extractContrib(s, outDir);
}

main()
  .then(() => sql.end())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await sql.end();
    process.exit(1);
  });
