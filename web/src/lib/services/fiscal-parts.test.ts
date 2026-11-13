/**
 * "Montar tabelas" by parts, end to end on local storage: the draft is a stand-in that keeps, per table,
 * the Parquet the regular ingest wrote.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EFD_CONTRIB } from "../fiscal/test-fixtures";

const root = mkdtempSync(path.join(os.tmpdir(), "dbi-fiscal-parts-"));
process.env.DBI_STORAGE_DRIVER = "local";
process.env.DBI_STORAGE_DIR = root;
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.DBI_DEMO_USER_EMAIL ??= "teste@example.com";

/** The draft: table → storage key of its Parquet and its lines. */
const draft = new Map<string, { key: string; rows: number }>();
let written = 0;

vi.mock("server-only", () => ({}));
vi.mock("../data/repository", () => ({
  getDraft: async () => ({ id: "rascunho", version: 1 }),
  listFiles: async () => [...draft].map(([tableName, f]) => ({ tableName, storagePath: f.key, rowCount: f.rows })),
}));
vi.mock("./datasets", async () => {
  const { ingestTable } = await import("../ingest/ingest");
  const { storage } = await import("../storage");
  return {
    UserFacingError: class UserFacingError extends Error {},
    ingestIntoDraft: async (_access: unknown, table: { name: string }, source: string, name: string) => {
      written += 1;
      const key = `orgs/acme/rascunho/${table.name}.${written}.parquet`;
      const report = await ingestTable({
        storageRoot: storage.workRoot, table: table as never, sourcePath: source,
        format: name.endsWith(".parquet") ? "parquet" : "csv", targetPath: storage.pathFor(key),
      });
      if (report.ok) draft.set(table.name, { key, rows: report.rowCount });
      return report;
    },
  };
});

const { fiscalImporterFor } = await import("../fiscal/importers");
const { partsFolderId } = await import("../fiscal/parts-plan");
const { SPED_READER_VERSION } = await import("../fiscal/sped-kinds");
const { templateSchema } = await import("../templates/schema");
const { assembleSpedFromParts, readSpedFile, rebuildSpedFromParts, spedFilesOverview, spedPartsState } = await import("./fiscal-parts");

const template = templateSchema.parse(JSON.parse(await readFile(path.join(process.cwd(), "fiscal-templates", "efd-contribuicoes.json"), "utf8")));
const importer = fiscalImporterFor("efd-contribuicoes");
if (importer?.mode !== "sped") throw new Error("expected the SPED importer");
const access = {
  org: { id: "o1", slug: "acme", name: "Acme" }, client: { id: "c1", slug: "cliente", name: "Cliente" },
  instanceId: "3f9a2c1b-7d2e-4c1a-9b0f-1e2d3c4b5a69", templateId: "efd-contribuicoes", activeVersionId: null,
} as never;
const CNPJ = "11222333000181";
const raw = (periodo: string): string => `orgs/acme/clientes/cliente/fiscal/efd-contribuicoes/${CNPJ}/${periodo}/PISCOFINS.txt`;
const partsRoot = path.join(root, "orgs/acme/clientes/cliente/dashboards/efd-contribuicoes-3f9a2c1b/partes");
const partsOf = (periodo: string): string[] => {
  try {
    return readdirSync(path.join(root, "orgs/acme/clientes/cliente/dashboards/efd-contribuicoes-3f9a2c1b/partes", CNPJ, periodo));
  } catch {
    return [];
  }
};

/** The sample file moved to another month (its 0000 says which). */
function monthOf(month: string, extra = ""): Buffer {
  const text = Buffer.from(EFD_CONTRIB).toString("latin1").replace("|01012025|31012025|", `|01${month}2025|28${month}2025|`);
  return Buffer.from(text + extra, "latin1");
}

async function put(periodo: string, bytes: Buffer, updatedAt: string) {
  const file = path.join(root, ...raw(periodo).split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return { key: raw(periodo), name: "PISCOFINS.txt", cnpj: CNPJ, periodo, sizeBytes: bytes.length, updatedAt };
}

const rows = (table: string): number | undefined => draft.get(table)?.rows;

beforeEach(() => {
  rmSync(path.join(root, "orgs"), { recursive: true, force: true });
  draft.clear();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("rebuildSpedFromParts", () => {
  it("reads each file once, and only what is new, changed or gone afterwards", async () => {
    const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
    const feb = await put("2025-02", monthOf("02"), "2026-11-10T10:00:00.000Z");

    // First time: both files are read; a block fact keeps every period, the main fact only the latest.
    const first = await rebuildSpedFromParts(access, importer, template, [jan, feb]);
    expect(first).toMatchObject({ ok: true, files: 2, read: 2, reused: 0, skipped: [] });
    expect(rows("bloco_a_servicos")).toBe(12);
    expect(rows("registros")).toBe(20); // one file of 20 records, not both (40)
    expect(rows("participantes")).toBe(1);
    expect([partsOf("2025-01"), partsOf("2025-02")].map((p) => p.length)).toEqual([1, 1]);

    // The lineage says where each table's lines came from, and it is kept next to the draft's tables.
    const blocoA = first.lineage?.tables.find((t) => t.table === "bloco_a_servicos");
    expect(blocoA?.sources.map((s) => [s.periodo, s.rows, s.file])).toEqual([
      ["2025-01", 6, "clientes/cliente/fiscal/efd-contribuicoes/11222333000181/2025-01/PISCOFINS.txt"],
      ["2025-02", 6, "clientes/cliente/fiscal/efd-contribuicoes/11222333000181/2025-02/PISCOFINS.txt"],
    ]);
    expect(first.lineage?.tables.find((t) => t.table === "registros")?.sources.map((s) => s.periodo)).toEqual(["2025-02"]);
    expect(first.lineage?.tables.find((t) => t.table === "bloco_c_resumo")?.how.join(" ")).toContain("As linhas do C170 são somadas");
    const kept = JSON.parse(await readFile(path.join(root, "orgs/acme/clientes/cliente/dashboards/efd-contribuicoes-3f9a2c1b/v1/linhagem.json"), "utf8"));
    expect(kept.tables.map((t: { table: string }) => t.table)).toContain("participantes");

    // Nothing new: nothing is read, the tables come out the same from the parts.
    const again = await rebuildSpedFromParts(access, importer, template, [jan, feb]);
    expect(again).toMatchObject({ ok: true, files: 2, read: 0, reused: 2 });
    expect([rows("bloco_a_servicos"), rows("registros"), rows("participantes")]).toEqual([12, 20, 1]);

    // A retificadora of February: only February is read again, and its old parts go.
    const before = partsOf("2025-02");
    const fixed = await put("2025-02", monthOf("02", "\r\n"), "2026-11-12T10:00:00.000Z");
    const retified = await rebuildSpedFromParts(access, importer, template, [jan, fixed]);
    expect(retified).toMatchObject({ ok: true, read: 1, reused: 1 });
    expect(partsOf("2025-02")).toHaveLength(1);
    expect(partsOf("2025-02")).not.toEqual(before);

    // January deleted: its parts go and its lines leave the tables.
    const without = await rebuildSpedFromParts(access, importer, template, [fixed]);
    expect(without).toMatchObject({ ok: true, files: 1, read: 0, reused: 1 });
    expect(partsOf("2025-01")).toEqual([]);
    expect(rows("bloco_a_servicos")).toBe(6);

    // Reading everything again, on request.
    expect(await rebuildSpedFromParts(access, importer, template, [fixed], { rereadAll: true })).toMatchObject({ read: 1, reused: 0 });
  }, 120_000);

  it("keeps the main fact out when only the blocks are asked for", async () => {
    const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
    const result = await rebuildSpedFromParts(access, importer, template, [jan], { only: "blocks" });
    expect(result.ok).toBe(true);
    expect(draft.has("registros")).toBe(false);
    expect(rows("bloco_a_servicos")).toBe(6);
  }, 120_000);

  it("reports a file it cannot read and still puts the others together", async () => {
    const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
    const broken = await put("2025-03", Buffer.from("isto não é um SPED\n"), "2026-11-10T10:00:00.000Z");
    const result = await rebuildSpedFromParts(access, importer, template, [jan, broken]);
    expect(result).toMatchObject({ ok: true, files: 1, read: 1 });
    expect(result.skipped).toHaveLength(1);
    // Only the failure record stays in its folder, so the panel can say why until the file changes.
    expect(partsOf("2025-03")).toHaveLength(1);
    expect(readdirSync(path.join(partsRoot, CNPJ, "2025-03", partsOf("2025-03")[0]))).toEqual(["erro.json"]);
    const overview = await spedFilesOverview(access, [jan, broken]);
    expect([...overview.ready]).toEqual([jan.key]);
    expect(overview.failures.get(broken.key)?.error).toBeTruthy();
  }, 120_000);
});

describe("one file at a time (the panel)", () => {
  it("reads file by file, resumes after an interruption, then puts the tables together without reading", async () => {
    const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
    const feb = await put("2025-02", monthOf("02"), "2026-11-10T10:00:00.000Z");

    expect(await readSpedFile(access, importer, template, jan)).toEqual({ ok: true, rows: 20 });
    // Nothing to put together while February is missing.
    await expect(assembleSpedFromParts(access, importer, template, [jan, feb])).rejects.toThrow(/1 arquivo/);

    // February's read was interrupted: parts without the marker. Reading it again starts from an empty folder.
    const id = partsOf("2025-01")[0];
    const febFolder = path.join(partsRoot, CNPJ, "2025-02", partsFolderId(feb, SPED_READER_VERSION));
    await mkdir(febFolder, { recursive: true });
    await writeFile(path.join(febFolder, "registros.parquet"), "partial");
    // And a leftover of a file that is gone.
    await mkdir(path.join(partsRoot, CNPJ, "2025-02", "0000000000000000"), { recursive: true });
    await writeFile(path.join(partsRoot, CNPJ, "2025-02", "0000000000000000", "registros.parquet"), "old");
    expect((await spedPartsState(access, importer, template, [jan, feb])).plan.read).toEqual([feb]);
    expect((await spedFilesOverview(access, [jan, feb])).ready).toEqual(new Set([jan.key]));
    expect(await readSpedFile(access, importer, template, feb)).toEqual({ ok: true, rows: 20 });

    const built = await assembleSpedFromParts(access, importer, template, [jan, feb]);
    expect(built).toMatchObject({ ok: true, files: 2, read: 0, reused: 2, skipped: [] });
    expect([rows("bloco_a_servicos"), rows("registros"), rows("participantes")]).toEqual([12, 20, 1]);
    // The interrupted folder that matched no file went; each month keeps one folder.
    expect(partsOf("2025-01")).toEqual([id]);
    expect(partsOf("2025-02")).toEqual([partsFolderId(feb, SPED_READER_VERSION)]);
    expect(built.lineage?.tables.find((t) => t.table === "participantes")?.sources).toHaveLength(2);
  }, 120_000);

  it("puts the tables together leaving out the files that failed", async () => {
    const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
    const broken = await put("2025-03", Buffer.from("isto não é um SPED\n"), "2026-11-10T10:00:00.000Z");
    await readSpedFile(access, importer, template, jan);
    expect(await readSpedFile(access, importer, template, broken)).toMatchObject({ ok: false });
    const built = await assembleSpedFromParts(access, importer, template, [jan, broken]);
    expect(built).toMatchObject({ ok: true, files: 1 });
    expect(built.skipped.map((s) => s.path)).toEqual(["clientes/cliente/fiscal/efd-contribuicoes/11222333000181/2025-03/PISCOFINS.txt"]);
  }, 120_000);
});
