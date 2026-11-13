import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EFD_CONTRIB, EFD_ICMS, nfeXml } from "../fiscal/test-fixtures";
import type { StoredAnalysis } from "../data/file-analysis";

// Local storage in a throwaway folder; the database is an in-memory stand-in.
const root = mkdtempSync(path.join(os.tmpdir(), "dbi-file-analysis-"));
process.env.DBI_STORAGE_DRIVER = "local";
process.env.DBI_STORAGE_DIR = root;
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.DBI_DEMO_USER_EMAIL ??= "teste@example.com";

const kept = new Map<string, StoredAnalysis>();
const reads = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../data/organizations", () => ({ listClients: async () => [{ id: "c1", slug: "martinello", name: "Martinello" }] }));
vi.mock("../data/instances", () => ({
  listOrgDashboards: async () => [{ id: "d1", name: "EFD Contribuições", templateId: "efd-contribuicoes", clientId: "c1" }],
}));
vi.mock("../templates/registry", () => ({
  getCatalogEntry: async () => ({
    template: { tables: [{ name: "itens", kind: "dimension", columns: [{ name: "codigo", type: "text", required: true }, { name: "descricao", type: "text", required: true }] }] },
  }),
}));
vi.mock("../data/file-analysis", () => ({
  readAnalyses: async (_org: string, keys: string[]) => {
    reads(keys);
    return keys.flatMap((k) => (kept.has(k) ? [kept.get(k)!] : []));
  },
  saveAnalyses: async (_org: string, rows: StoredAnalysis[]) => rows.forEach((r) => kept.set(r.key, r)),
  moveAnalyses: async (_org: string, from: string, to: string) => {
    const a = kept.get(from);
    if (a) {
      kept.delete(from);
      kept.set(to, { ...a, key: to });
    }
  },
  forgetAnalyses: async () => undefined,
}));

const svc = await import("./file-analysis");
const ctx = { org: { id: "o1", slug: "davos", name: "Davos" }, membership: { orgRole: "admin", clientRoles: {} } } as never;
const orgDir = path.join(root, "orgs", "davos");

async function put(rel: string, content: string | Uint8Array): Promise<void> {
  const file = path.join(orgDir, ...rel.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

beforeEach(async () => {
  rmSync(orgDir, { recursive: true, force: true });
  kept.clear();
  reads.mockClear();
  await put("clientes/martinello/lote/PISCOFINS.txt", EFD_CONTRIB);
  await put("clientes/martinello/lote/icms.txt", EFD_ICMS);
  await put("clientes/martinello/lote/nota.xml", nfeXml());
  await put("clientes/martinello/lote/itens.csv", "Código;Descrição;Unidade\nP1;Amortecedor;UN\n");
  await put("clientes/martinello/lote/outra.csv", "codigo,preco\nP1,10\n");
  await put("clientes/martinello/lote/manual.pdf", "%PDF-1.4");
  await put("clientes/martinello/lote/leia.txt", "apenas um texto\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("analyzeFolder", () => {
  it("tells the layout of each file and whether it is ready or needs treatment", async () => {
    const out = await svc.analyzeFolder(ctx, "clientes/martinello/lote");
    const v = (name: string) => out[`clientes/martinello/lote/${name}`].verdict;
    expect(v("PISCOFINS.txt")).toMatchObject({ status: "treatment", layout: "EFD Contribuições · 11.222.333/0001-81 · 01/2025", buildIn: ["EFD Contribuições"], inStandard: false });
    expect(v("icms.txt")).toMatchObject({ status: "treatment", layout: "EFD ICMS/IPI · 11.222.333/0001-81 · 01/2025", buildIn: [] });
    expect(v("nota.xml")).toMatchObject({ status: "treatment", layout: "NF-e · 11.222.333/0001-81 · 02/2025" });
    expect(v("itens.csv")).toMatchObject({ status: "ready", readyFor: [{ dashboard: "EFD Contribuições", table: "itens" }] });
    expect(v("outra.csv")).toMatchObject({ status: "treatment", closest: { table: "itens", missing: ["descricao"] } });
    expect(v("manual.pdf").status).toBe("document");
    expect(v("leia.txt").status).toBe("unknown");
  });

  it("reads each file once and again only when it changes", async () => {
    await svc.analyzeFolder(ctx, "clientes/martinello/lote");
    expect(kept.size).toBe(7);
    const before = kept.get("orgs/davos/clientes/martinello/lote/itens.csv")!;
    await svc.analyzeFolder(ctx, "clientes/martinello/lote");
    expect(kept.get("orgs/davos/clientes/martinello/lote/itens.csv")).toBe(before); // kept, not read again
    await put("clientes/martinello/lote/itens.csv", "a;b\n");
    const out = await svc.analyzeFolder(ctx, "clientes/martinello/lote");
    expect(out["clientes/martinello/lote/itens.csv"].verdict.status).toBe("treatment");
  });
});

/** Runs "Organizar pasta" to the end, step by step, as the dialog does. */
async function organizeAll(folder: string, stepFiles?: number) {
  const total = { moved: [] as { path: string; to: string }[], kept: [] as { path: string; reason: string }[], unrecognized: 0, others: 0, scanned: 0, steps: 0 };
  let cursor: Awaited<ReturnType<typeof svc.organizeStep>>["next"] = null;
  do {
    const step = await svc.organizeStep(ctx, folder, cursor, stepFiles);
    total.moved.push(...step.moved);
    total.kept.push(...step.kept);
    total.unrecognized += step.unrecognized;
    total.others += step.others;
    total.scanned += step.scanned;
    total.steps += 1;
    cursor = step.next;
  } while (cursor && total.steps < 100);
  return total;
}

const filedIn = (rel: string) => readdir(path.join(orgDir, rel));

describe("organize", () => {
  it("files the loose fiscal files in their standard folders, with their own names", async () => {
    const res = await organizeAll("clientes/martinello");
    expect(res.moved.map((m) => [m.path, m.to]).sort()).toEqual([
      ["clientes/martinello/lote/PISCOFINS.txt", "clientes/martinello/fiscal/efd-contribuicoes/11222333000181/2025-01"],
      ["clientes/martinello/lote/icms.txt", "clientes/martinello/fiscal/efd-icms-ipi/11222333000181/2025-01"],
      ["clientes/martinello/lote/nota.xml", "clientes/martinello/fiscal/nfe/11222333000181/2025-02"],
    ]);
    expect(res.unrecognized).toBe(1); // leia.txt
    expect(res.others).toBe(3);
    expect(await filedIn("clientes/martinello/fiscal/efd-contribuicoes/11222333000181/2025-01")).toEqual(["PISCOFINS.txt"]);
    expect((await readdir(path.join(orgDir, "clientes/martinello/lote"))).sort()).toEqual(["itens.csv", "leia.txt", "manual.pdf", "outra.csv"]);
  });

  it("gives the same result in small steps (nothing skipped, nothing twice)", async () => {
    const res = await organizeAll("clientes/martinello", 2);
    expect(res.steps).toBeGreaterThan(3);
    expect(res.moved).toHaveLength(3);
    expect(res.scanned).toBe(7);
    expect(res.kept).toEqual([]);
  });

  it("leaves the standard folders closed and finds nothing more to do the second time", async () => {
    await organizeAll("clientes/martinello");
    const again = await organizeAll("clientes/martinello");
    expect(again.moved).toEqual([]);
    expect(again.scanned).toBe(4); // only what stayed in "lote"; the filed ones are not opened
  });

  it("never leaves the folder being organized", async () => {
    await expect(svc.organizeStep(ctx, "clientes/martinello/lote", { queue: ["clientes/outro"], skip: 0, expanded: false })).rejects.toThrow();
    await expect(svc.organizeStep(ctx, "clientes/martinello", { queue: ["clientes/martinello/dashboards"], skip: 0, expanded: false })).rejects.toThrow();
  });
});

describe("organize (copies of the same document)", () => {
  it("keeps the newest copy filed and never lets an older one replace it", async () => {
    const { utimes } = await import("node:fs/promises");
    await put("clientes/martinello/lote/original.txt", EFD_CONTRIB);
    await put("clientes/martinello/lote/retificadora.txt", EFD_CONTRIB);
    await utimes(path.join(orgDir, "clientes/martinello/lote/original.txt"), new Date("2026-01-01"), new Date("2026-01-01"));
    await utimes(path.join(orgDir, "clientes/martinello/lote/retificadora.txt"), new Date("2026-03-01"), new Date("2026-03-01"));
    await utimes(path.join(orgDir, "clientes/martinello/lote/PISCOFINS.txt"), new Date("2026-02-01"), new Date("2026-02-01"));

    const res = await organizeAll("clientes/martinello/lote");
    expect(await filedIn("clientes/martinello/fiscal/efd-contribuicoes/11222333000181/2025-01")).toEqual(["retificadora.txt"]);
    expect(res.kept.map((k) => k.path)).toEqual(["clientes/martinello/lote/original.txt"]);
  });
});
