/**
 * The panel of fiscal data on local storage: the map of a model from its files and parts, and the lineage
 * read back from where "Montar tabelas" kept it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(path.join(os.tmpdir(), "dbi-fiscal-panel-"));
process.env.DBI_STORAGE_DRIVER = "local";
process.env.DBI_STORAGE_DIR = root;
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.DBI_DEMO_USER_EMAIL ??= "teste@example.com";

const DASHBOARD = "3f9a2c1b-7d2e-4c1a-9b0f-1e2d3c4b5a69";
vi.mock("server-only", () => ({}));
vi.mock("../data/instances", () => ({
  listSpaceDashboards: async () => [
    { id: DASHBOARD, name: "EFD ICMS/IPI", templateId: "efd-icms-ipi", activeVersionId: "v-ativa", publishedAt: new Date("2026-11-10T12:00:00Z"), draftId: null },
  ],
}));
vi.mock("../data/repository", () => ({
  getDraft: async () => null,
  getVersion: async (id: string) => (id === "v-ativa" ? { id, version: 3 } : null),
  listFiles: async () => [{ tableName: "registros", storagePath: "x", rowCount: 40, sizeBytes: 1000, originalName: "r", createdAt: new Date() }],
}));

const { loadFiscalPanel, loadLineage, loadLineageSources } = await import("./fiscal-panel");
const { partsFolderId } = await import("../fiscal/parts-plan");
const { SPED_READER_VERSION } = await import("../fiscal/sped-kinds");
const { storage } = await import("../storage");

const org = { id: "o1", slug: "acme", name: "Acme" };
const client = { id: "c1", slug: "cliente", name: "Cliente" };
const CNPJ = "11222333000181";
const space = path.join(root, "orgs/acme/clientes/cliente");
const icms = path.join(space, "fiscal/efd-icms-ipi");
const parts = path.join(space, "dashboards/efd-icms-ipi-3f9a2c1b/partes");

async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** The raw file as the panel lists it (its parts folder is named after its size and date). */
async function rawOf(periodo: string) {
  const key = `orgs/acme/clientes/cliente/fiscal/efd-icms-ipi/${CNPJ}/${periodo}/EFD.txt`;
  const [f] = (await storage.listTree(`orgs/acme/clientes/cliente/fiscal/efd-icms-ipi/${CNPJ}/${periodo}/`));
  return { key, name: "EFD.txt", cnpj: CNPJ, periodo, sizeBytes: f.sizeBytes, updatedAt: f.updatedAt ? new Date(f.updatedAt).toISOString() : null };
}

beforeEach(() => rmSync(path.join(root, "orgs"), { recursive: true, force: true }));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("loadFiscalPanel", () => {
  it("maps each file: read, missing or failed, with the dashboard's published tables", async () => {
    for (const p of ["2026-01", "2026-02", "2026-03"]) await put(path.join(icms, CNPJ, p, "EFD.txt"), `|0000|${p}|\n`);
    await put(path.join(icms, "solto.txt"), "x");
    await put(path.join(space, "outro.xml"), "<x/>");
    const jan = await rawOf("2026-01");
    const mar = await rawOf("2026-03");
    await put(path.join(parts, CNPJ, "2026-01", partsFolderId(jan, SPED_READER_VERSION), "pronto.json"), "{}");
    await put(path.join(parts, CNPJ, "2026-03", partsFolderId(mar, SPED_READER_VERSION), "erro.json"), JSON.stringify({ error: "Arquivo sem 0000.", at: "t" }));
    // A marker of an older content of February does not count.
    await put(path.join(parts, CNPJ, "2026-02", "0000000000000000", "pronto.json"), "{}");

    const view = await loadFiscalPanel(org, client, true);
    expect(view.looseInSpace).toBe(1);
    expect(view.models.map((m) => m.templateId)).toEqual(["efd-icms-ipi"]);
    const [model] = view.models;
    expect(model.counts).toMatchObject({ pronto: 1, falta: 1, erro: 1 });
    expect(model.loose).toBe(1);
    expect(model.map.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(model.toRead.map((f) => f.periodo)).toEqual(["2026-02", "2026-03"]);
    expect(model.failed[0]).toMatchObject({ periodo: "2026-03", error: "Arquivo sem 0000.", path: `clientes/cliente/fiscal/efd-icms-ipi/${CNPJ}/2026-03/EFD.txt` });
    expect(model.dashboard).toMatchObject({ id: DASHBOARD, published: [{ table: "registros", rows: 40 }], draft: null });

    // Who only views sees the map, never the list of files to read.
    expect((await loadFiscalPanel(org, client, false)).models[0].toRead).toEqual([]);
  });
});

describe("lineage", () => {
  const access = { org, client, instanceId: DASHBOARD, templateId: "efd-icms-ipi", activeVersionId: "v-ativa" } as never;

  it("reads the published version's linhagem.json, sums each table up and pages its files", async () => {
    const sources = Array.from({ length: 3 }, (_, i) => ({
      file: `f/${i}.txt`, cnpj: CNPJ, periodo: `2026-0${i + 1}`, sizeBytes: 10, updatedAt: null, rows: 5,
    }));
    await put(path.join(space, "dashboards/efd-icms-ipi-3f9a2c1b/v3/linhagem.json"), JSON.stringify({
      dashboard: DASHBOARD, template: "efd-icms-ipi", builtAt: "2026-11-13T10:00:00.000Z", reader: 3,
      tables: [{ table: "registros", kind: "fact", how: ["O arquivo inteiro."], rows: 15, sources }],
    }));
    expect(await loadLineage(access, "publicada")).toEqual({
      builtAt: "2026-11-13T10:00:00.000Z", reader: 3,
      tables: [{ table: "registros", kind: "fact", how: ["O arquivo inteiro."], rows: 15, files: 3, companies: 1, from: "2026-01", to: "2026-03" }],
    });
    const page = await loadLineageSources(access, "publicada", "registros", 0, 2);
    expect(page?.total).toBe(3);
    expect(page?.sources.map((s) => s.periodo)).toEqual(["2026-03", "2026-02"]);
    expect(await loadLineageSources(access, "publicada", "outra", 0, 2)).toBeNull();
  });

  it("has nothing to show without a lineage (tables put together before it existed) or without a draft", async () => {
    expect(await loadLineage(access, "publicada")).toBeNull();
    expect(await loadLineage(access, "rascunho")).toBeNull();
  });
});
