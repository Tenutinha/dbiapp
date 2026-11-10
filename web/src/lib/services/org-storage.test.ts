import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Local storage in a throwaway folder; the database and access checks are stubbed.
const root = mkdtempSync(path.join(os.tmpdir(), "dbi-org-storage-"));
process.env.DBI_STORAGE_DRIVER = "local";
process.env.DBI_STORAGE_DIR = root;
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.DBI_DEMO_USER_EMAIL ??= "teste@example.com";

vi.mock("server-only", () => ({}));
vi.mock("../data/organizations", () => ({
  listClients: async () => [{ id: "c1", slug: "martinello", name: "Martinello" }],
}));
vi.mock("../data/instances", () => ({
  listFileUses: async () => [{ file: "PISCOFINS.txt", clientSlug: "martinello", dashboard: "EFD Contribuições", state: "active" }],
}));
vi.mock("../access", () => ({ getOrgContext: vi.fn(), orgActions: vi.fn(), requireAction: vi.fn() }));
vi.mock("../data/file-analysis", () => ({ moveAnalyses: vi.fn(async () => undefined), forgetAnalyses: vi.fn(async () => undefined) }));

const svc = await import("./org-storage");
const ctx = { org: { id: "o1", slug: "davos", name: "Davos" } } as never;
const orgDir = path.join(root, "orgs", "davos");

async function put(rel: string, content = "x"): Promise<void> {
  const file = path.join(orgDir, ...rel.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

const names = async (rel = ""): Promise<string[]> => (await readdir(path.join(orgDir, ...rel.split("/").filter(Boolean)))).sort();

beforeEach(async () => {
  rmSync(orgDir, { recursive: true, force: true });
  await put("clientes/martinello/PISCOFINS.txt", "1234");
  await put("lotes/2026/a.csv");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("listExplorerFolder", () => {
  it("lists folders and files from storage, and the clients and file uses apart", async () => {
    const out = await svc.listExplorerFolder(ctx, "clientes/martinello");
    expect(out.entries).toEqual([
      expect.objectContaining({ name: "PISCOFINS.txt", path: "clientes/martinello/PISCOFINS.txt", folder: false, sizeBytes: 4 }),
    ]);
    const top = await svc.listExplorerFolder(ctx, "");
    expect(top.entries.map((i) => [i.name, i.folder])).toEqual([["clientes", true], ["lotes", true]]);
    expect(await svc.explorerMeta(ctx)).toEqual({
      clients: [{ slug: "martinello", name: "Martinello" }],
      uses: [{ file: "PISCOFINS.txt", clientSlug: "martinello", dashboard: "EFD Contribuições", state: "active" }],
    });
  });

  it("refuses paths that try to leave the organization's folder", async () => {
    await expect(svc.listExplorerFolder(ctx, "../outra")).rejects.toThrow("Pasta inválida");
  });
});

describe("organizing", () => {
  it("creates nested folders with safe names", async () => {
    expect(await svc.createFolder(ctx, "lotes", "Julho 2026/notas")).toEqual({ path: "lotes/Julho-2026/notas" });
    expect(await names("lotes/Julho-2026")).toEqual(["notas"]);
  });

  it("renames a file keeping its extension, and a folder", async () => {
    expect(await svc.renameItem(ctx, "clientes/martinello/PISCOFINS.txt", "julho")).toEqual({ path: "clientes/martinello/julho.txt" });
    expect(await svc.renameItem(ctx, "lotes/2026", "ano 2026")).toEqual({ path: "lotes/ano-2026" });
    expect(await names("lotes/ano-2026")).toEqual(["a.csv"]);
  });

  it("never creates or fills folders that only look like clients", async () => {
    await expect(svc.createFolder(ctx, "clientes", "inventado")).rejects.toThrow("não é um cliente");
    await expect(svc.planUpload({ id: "o1", slug: "davos" }, "clientes", "a.csv", 10)).rejects.toThrow("só ficam as pastas dos clientes");
    await expect(svc.moveItems(ctx, ["lotes/2026/a.csv"], "clientes/inventado")).rejects.toThrow("não é um cliente");
    expect(await names("clientes")).toEqual(["martinello"]);
  });

  it("hides and never touches the platform's own folders", async () => {
    await put("datasets/x/v1/t.parquet");
    expect((await svc.listExplorerFolder(ctx, "")).entries.map((i) => i.name)).not.toContain("datasets");
    await expect(svc.listExplorerFolder(ctx, "datasets")).rejects.toThrow("da plataforma");
    const res = await svc.removeItems(ctx, ["datasets", "datasets/x/v1/t.parquet"]);
    expect(res.done).toEqual([]);
    await expect(svc.renameItem(ctx, "datasets", "outro")).rejects.toThrow("da plataforma");
    expect(await names("datasets/x/v1")).toEqual(["t.parquet"]);
  });

  it("does not rename client folders", async () => {
    await expect(svc.renameItem(ctx, "clientes/martinello", "outro")).rejects.toThrow("endereço do cliente");
  });

  it("moves files and folders, reporting what could not go", async () => {
    const res = await svc.moveItems(ctx, ["lotes/2026/a.csv", "lotes", "clientes/martinello"], "clientes/martinello");
    expect(res.done).toEqual(["lotes/2026/a.csv", "lotes"]);
    expect(res.failed.map((f) => f.path)).toEqual(["clientes/martinello"]);
    expect(await names("clientes/martinello")).toEqual(["PISCOFINS.txt", "a.csv", "lotes"]);
    expect(await names("clientes/martinello/lotes")).toEqual(["2026"]);
  });

  it("does not overwrite an item with the same name at the target", async () => {
    await put("clientes/martinello/a.csv");
    const res = await svc.moveItems(ctx, ["lotes/2026/a.csv"], "clientes/martinello");
    expect(res.failed[0].error).toContain("Já existe");
  });

  it("removes files and whole folders, but never a client folder", async () => {
    const res = await svc.removeItems(ctx, ["lotes", "clientes/martinello/PISCOFINS.txt", "clientes/martinello"]);
    expect(res.done).toEqual(["lotes", "clientes/martinello/PISCOFINS.txt"]);
    expect(res.failed.map((f) => f.path)).toEqual(["clientes/martinello"]);
    expect(await names()).toEqual(["clientes"]);
    expect(await names("clientes/martinello")).toEqual([]);
  });
});

describe("uploads", () => {
  it("stores a file under a free, safe name", async () => {
    const file = new File(["a,b\n1,2"], "Relatório Julho.csv", { type: "text/csv" });
    expect(await svc.storeUpload({ id: "o1", slug: "davos" }, "lotes/2026", file)).toEqual({ name: "Relatorio-Julho.csv" });
    expect(await svc.storeUpload({ id: "o1", slug: "davos" }, "lotes/2026", file)).toEqual({ name: "Relatorio-Julho-2.csv" });
    expect(await svc.planUpload({ id: "o1", slug: "davos" }, "lotes/2026", "x.csv", 10)).toEqual({ mode: "direct", name: "x.csv" });
  });
});
