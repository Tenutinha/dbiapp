/**
 * Moves the dashboards' Parquet files to their folder in the space they belong to:
 * orgs/<org>/clientes/<cliente>/dashboards/<molde>-<id>/… (or orgs/<org>/dashboards/… for the organization's
 * own space), e.g. dashboards/efd-contribuicoes-c680b903/. They come from orgs/<org>/datasets/<dashboard>/…
 * (the first layout) or from dashboards/<dashboard>/… (the folder named by the whole id). See storage-keys.ts.
 *
 *   node --env-file=<.env de produção> --import tsx scripts/migrar-dashboards.ts            plano (não muda nada)
 *   node --env-file=<.env de produção> --import tsx scripts/migrar-dashboards.ts aplicar    move de verdade
 *
 * For each table of the active version and of a draft in progress: copy every part inside Google (the data
 * never passes through this machine), check the hash, repoint dataset_files in one transaction, and only
 * then delete the old objects. Files used only by older (archived) versions are deleted: only the published
 * version is kept. Running it again resumes where it stopped (rows already moved are skipped).
 */
import path from "node:path";
import { Storage, type Bucket } from "@google-cloud/storage";
import postgres from "postgres";
import { dashboardFolderName } from "../src/lib/storage-keys";

const APPLY = process.argv.includes("aplicar");
const BUCKET = process.env.GCS_BUCKET ?? process.env.DBI_STORAGE_BUCKET ?? "dbi-app-br-arquivos";
const SEPARATOR = "\n";

interface Row {
  fileId: string;
  versionId: string;
  status: "active" | "draft" | "archived";
  instanceId: string;
  templateId: string;
  orgSlug: string;
  clientSlug: string | null;
  storagePath: string;
}

const parts = (p: string): string[] => p.split(SEPARATOR).filter((x) => x !== "");
const legacyPrefix = (r: Row): string => `orgs/${r.orgSlug}/datasets/${r.instanceId}/`;
const spacePrefix = (r: Row): string => `orgs/${r.orgSlug}/${r.clientSlug ? `clientes/${r.clientSlug}/` : ""}dashboards/`;
/** The folder the dashboard had at first in its space, named by its whole id. */
const byIdPrefix = (r: Row): string => `${spacePrefix(r)}${r.instanceId}/`;
const newPrefix = (r: Row): string => `${spacePrefix(r)}${dashboardFolderName(r.templateId, r.instanceId)}/`;

/** Where a part goes (null = already in the new layout, or not one of ours to move). */
function target(r: Row, key: string): string | null {
  const from = [legacyPrefix(r), byIdPrefix(r)].find((prefix) => key.startsWith(prefix));
  return from ? `${newPrefix(r)}${key.slice(from.length)}` : null;
}

async function md5(bucket: Bucket, key: string): Promise<string | null> {
  const [meta] = await bucket.file(key).getMetadata().catch(() => [null]);
  return meta ? String(meta.md5Hash ?? meta.crc32c ?? "") : null;
}

/** Copies `from` to `to` inside the bucket and checks the copy; true when `to` holds the same bytes. */
async function copyChecked(bucket: Bucket, from: string, to: string): Promise<boolean> {
  const source = await md5(bucket, from);
  const already = await md5(bucket, to);
  if (source === null) return already !== null; // moved by an earlier run: the copy is what is left
  if (already !== source) await bucket.file(from).copy(bucket.file(to));
  return (await md5(bucket, to)) === source;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definido (use --env-file).");
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const storage = new Storage({ keyFilename: keyFile ? path.resolve(keyFile) : undefined });
  const bucket = storage.bucket(BUCKET);
  const sql = postgres(url, { max: 2, prepare: false });

  try {
    const rows = await sql<Row[]>`
      SELECT f.id AS "fileId", v.id AS "versionId", v.status, i.id AS "instanceId", i.template_id AS "templateId",
             o.slug AS "orgSlug", c.slug AS "clientSlug", f.storage_path AS "storagePath"
      FROM dataset_files f
      JOIN dataset_versions v ON v.id = f.version_id
      JOIN dashboard_instances i ON i.id = v.instance_id
      JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN org_clients c ON c.id = i.client_id
      ORDER BY o.slug, i.id, v.version`;

    const live = rows.filter((r) => r.status !== "archived");
    const used = new Set(live.flatMap((r) => parts(r.storagePath)));
    const toMove = live.filter((r) => parts(r.storagePath).some((k) => target(r, k) !== null));
    // Old versions' files nobody uses any more (a table not re-sent keeps pointing to its old file: kept).
    const toDelete = [...new Set(rows.filter((r) => r.status === "archived").flatMap((r) => parts(r.storagePath)))]
      .filter((k) => !used.has(k) && k.includes("/datasets/"));

    console.log(`${rows.length} tabelas registradas · ${toMove.length} a mover (${toMove.reduce((n, r) => n + parts(r.storagePath).length, 0)} arquivos) · ${toDelete.length} arquivos de versões antigas a apagar`);
    for (const r of toMove) console.log(`  ${r.status.padEnd(6)} ${path.posix.dirname(path.posix.dirname(parts(r.storagePath)[0]))}/ → ${newPrefix(r)} (${parts(r.storagePath).length} arquivo(s))`);
    if (!APPLY) {
      console.log("\nPlano apenas. Rode com \"aplicar\" para mover.");
      return;
    }

    let moved = 0;
    for (const r of toMove) {
      const plan = parts(r.storagePath).map((k) => ({ from: k, to: target(r, k) ?? k }));
      const ok = await Promise.all(plan.map((p) => (p.from === p.to ? true : copyChecked(bucket, p.from, p.to))));
      if (ok.includes(false)) {
        console.error(`  ✗ cópia não conferiu: ${r.fileId} (${legacyPrefix(r)}) — nada mudou para esta tabela`);
        continue;
      }
      const updated = await sql`
        UPDATE dataset_files SET storage_path = ${plan.map((p) => p.to).join(SEPARATOR)}
        WHERE id = ${r.fileId} AND storage_path = ${r.storagePath}`;
      if (updated.count !== 1) {
        console.error(`  ✗ a tabela mudou durante a migração: ${r.fileId} — cópias mantidas, original intacto`);
        continue;
      }
      await Promise.all(plan.filter((p) => p.from !== p.to).map((p) => bucket.file(p.from).delete({ ignoreNotFound: true })));
      moved += 1;
    }

    let deleted = 0;
    for (const key of toDelete) {
      await bucket.file(key).delete({ ignoreNotFound: true });
      deleted += 1;
    }
    console.log(`\nPronto: ${moved}/${toMove.length} tabelas movidas, ${deleted} arquivos de versões antigas apagados.`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
