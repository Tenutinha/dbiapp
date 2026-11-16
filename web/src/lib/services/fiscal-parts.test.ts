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
/** Lines of each converted part (a table of several parts adds them up). */
const partRows = new Map<string, number>();

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
    // A table of several parts (one per year): each part is converted, then the table is made of them.
    convertToPart: async (_access: unknown, table: { name: string }, source: string) => {
      written += 1;
      const key = `orgs/acme/rascunho/${table.name}.${written}.parquet`;
      const report = await ingestTable({ storageRoot: storage.workRoot, table: table as never, sourcePath: source, format: "parquet", targetPath: storage.pathFor(key) });
      if (report.ok) partRows.set(key, report.rowCount);
      return { ...report, key };
    },
    registerParts: async (_access: unknown, table: { name: string }, parts: { key: string }[]) => {
      const rowCount = parts.reduce((s, p) => s + (partRows.get(p.key) ?? 0), 0);
      draft.set(table.name, { key: parts.map((p) => p.key).join("\n"), rows: rowCount });
      return { table: table.name, ok: true, rowCount, sizeBytes: 0, errors: [], warnings: [] };
    },
    discardParts: async () => undefined,
  };
});

const { fiscalImporterFor } = await import("../fiscal/importers");
const { partsFolderId } = await import("../fiscal/parts-plan");
const { SPED_READER_VERSION } = await import("../fiscal/sped-kinds");
const { templateSchema } = await import("../templates/schema");
const {
  assembleSpedFromParts, inBatches, withRetries, yearlyMinRows, readBuildStatus, readConcurrency, readSpedFile, rebuildSpedFromParts, spedFilesOverview, spedPartsState,
} = await import("./fiscal-parts");

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
function monthOf(month: string, extra = "", year = "2025"): Buffer {
  const text = Buffer.from(EFD_CONTRIB).toString("latin1").replace("|01012025|31012025|", `|01${month}${year}|28${month}${year}|`);
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

  it("reads several files at a time with the same result, telling how far it is", async () => {
    const months = ["01", "02", "03", "04"];
    const files = await Promise.all(months.map((m) => put(`2025-${m}`, monthOf(m), "2026-11-10T10:00:00.000Z")));
    const progress: number[] = [];
    process.env.DBI_FISCAL_READ_CONCURRENCY = "3";
    try {
      const result = await rebuildSpedFromParts(access, importer, template, files, { onProgress: (done) => progress.push(done) });
      expect(result).toMatchObject({ ok: true, files: 4, read: 4, skipped: [] });
    } finally {
      delete process.env.DBI_FISCAL_READ_CONCURRENCY;
    }
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(rows("bloco_a_servicos")).toBe(24);
    expect(months.map((m) => partsOf(`2025-${m}`).length)).toEqual([1, 1, 1, 1]);
  }, 120_000);
});

describe("the build's status (montagem.json, for the panel)", () => {
  const ref = { org: { slug: "acme" }, client: { slug: "cliente" }, instanceId: "3f9a2c1b-7d2e-4c1a-9b0f-1e2d3c4b5a69", templateId: "efd-contribuicoes" } as never;

  it("says who ran it and how it ended, also when it fails", async () => {
    expect(await readBuildStatus(ref)).toBeNull();
    const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
    await rebuildSpedFromParts(access, importer, template, [jan], { by: "script" });
    expect(await readBuildStatus(ref)).toMatchObject({ state: "concluida", by: "script", files: 1 });

    await expect(rebuildSpedFromParts(access, importer, template, [])).rejects.toThrow(/Nenhum arquivo/);
    expect(await readBuildStatus(ref)).toMatchObject({ state: "falhou", by: "tela", error: "Nenhum arquivo enviado ainda." });
  }, 120_000);
});

describe("readConcurrency", () => {
  it("is one file at a time unless a sensible number is set", () => {
    expect([readConcurrency(undefined), readConcurrency("0"), readConcurrency("x"), readConcurrency("2.5")]).toEqual([1, 1, 1, 1]);
    expect([readConcurrency("6"), readConcurrency("99")]).toEqual([6, 16]);
  });
});

describe("inBatches", () => {
  it("keeps the order of the items and never runs more than the size at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await inBatches([5, 1, 4, 2, 3, 0], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
    expect(await inBatches([], 4, async (n: number) => n)).toEqual([]);
  });
});

describe("withRetries", () => {
  it("tries again after a failure and gives up after the last attempt", async () => {
    let calls = 0;
    const flaky = async (): Promise<string> => {
      calls += 1;
      if (calls < 3) throw new Error("502");
      return "ok";
    };
    expect(await withRetries(flaky, 4, 1)).toBe("ok");
    expect(calls).toBe(3);

    calls = 0;
    await expect(withRetries(async () => {
      calls += 1;
      throw new Error("down");
    }, 2, 1)).rejects.toThrow("down");
    expect(calls).toBe(2);
  });
});

describe("main fact of older periods and parts kept on this machine", () => {
  const filesIn = (periodo: string): string[] => partsOf(periodo).flatMap((id) => readdirSync(path.join(partsRoot, CNPJ, periodo, id)));

  it("does not keep the whole file of a month that is not the latest, and reads it again when it becomes the latest", async () => {
    const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
    const feb = await put("2025-02", monthOf("02"), "2026-11-10T10:00:00.000Z");
    await rebuildSpedFromParts(access, importer, template, [jan, feb]);
    expect(filesIn("2025-01")).not.toContain("registros.parquet");
    expect(filesIn("2025-01")).toContain("bloco_a_servicos.parquet");
    expect(filesIn("2025-02")).toContain("registros.parquet");

    // February is gone: January is now the latest, and its whole file is needed.
    const again = await rebuildSpedFromParts(access, importer, template, [jan]);
    expect(again).toMatchObject({ ok: true, files: 1, read: 1, reused: 0 });
    expect(filesIn("2025-01")).toContain("registros.parquet");
    expect(rows("registros")).toBe(20);
  });

  it("works the same with the parts kept on this machine only", async () => {
    process.env.DBI_FISCAL_LOCAL_PARTS = "1";
    try {
      const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
      const feb = await put("2025-02", monthOf("02"), "2026-11-10T10:00:00.000Z");
      const first = await rebuildSpedFromParts(access, importer, template, [jan, feb]);
      expect(first).toMatchObject({ ok: true, files: 2, read: 2, reused: 0, skipped: [] });
      expect(rows("bloco_a_servicos")).toBe(12);
      expect(filesIn("2025-02")).toContain("pronto.json");

      const second = await rebuildSpedFromParts(access, importer, template, [jan, feb]);
      expect(second).toMatchObject({ ok: true, read: 0, reused: 2 });
      expect((await spedPartsState(access, importer, template, [jan, feb])).plan.read).toEqual([]);
    } finally {
      delete process.env.DBI_FISCAL_LOCAL_PARTS;
    }
  });
});

describe("a big fact as one Parquet per year", () => {
  const partsOfTable = (table: string): string[] => (draft.get(table)?.key ?? "").split("\n").filter(Boolean);

  it("splits by year, and a new month rewrites only its year", async () => {
    process.env.DBI_FISCAL_YEARLY_MIN_ROWS = "1";
    try {
      const dec = await put("2024-12", monthOf("12", "", "2024"), "2026-11-10T10:00:00.000Z");
      const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
      const first = await rebuildSpedFromParts(access, importer, template, [dec, jan]);
      expect(first.ok).toBe(true);
      const before = partsOfTable("bloco_a_servicos");
      expect(before).toHaveLength(2);
      expect(rows("bloco_a_servicos")).toBe(12);
      // The whole file is kept for the latest month only: one year, one file.
      expect(partsOfTable("registros")).toHaveLength(1);

      const feb = await put("2025-02", monthOf("02"), "2026-11-10T10:00:00.000Z");
      const second = await rebuildSpedFromParts(access, importer, template, [dec, jan, feb]);
      expect(second).toMatchObject({ ok: true, read: 1, reused: 2 });
      const after = partsOfTable("bloco_a_servicos");
      expect(after).toHaveLength(2);
      expect(after[0]).toBe(before[0]); // 2024 did not change: the same Parquet
      expect(after[1]).not.toBe(before[1]); // 2025 gained a month
      expect(rows("bloco_a_servicos")).toBe(18);
    } finally {
      delete process.env.DBI_FISCAL_YEARLY_MIN_ROWS;
    }
  });

  it("keeps a small fact, or a fact of a single year, in one file", async () => {
    const dec = await put("2024-12", monthOf("12", "", "2024"), "2026-11-10T10:00:00.000Z");
    const jan = await put("2025-01", monthOf("01"), "2026-11-10T10:00:00.000Z");
    await rebuildSpedFromParts(access, importer, template, [dec, jan]);
    expect(partsOfTable("bloco_a_servicos")).toHaveLength(1); // 12 lines: far below the default

    process.env.DBI_FISCAL_YEARLY_MIN_ROWS = "1";
    try {
      draft.clear();
      const feb = await put("2025-02", monthOf("02"), "2026-11-10T10:00:00.000Z");
      await rebuildSpedFromParts(access, importer, template, [jan, feb]);
      expect(partsOfTable("bloco_a_servicos")).toHaveLength(1);
      expect(yearlyMinRows("abc")).toBe(1_000_000);
      expect(yearlyMinRows("0")).toBe(0);
    } finally {
      delete process.env.DBI_FISCAL_YEARLY_MIN_ROWS;
    }
  });
});
