import { describe, expect, it } from "vitest";
import type { TableLineage } from "./lineage";
import {
  countStates, documentFileStatuses, fileMap, filesToRead, isFiscalPanel, lineageSourcesPage, lineageTableView,
  monthsBetween, parseLineage, spedFileStatuses, type FileStatus,
} from "./panel";
import type { RawFile } from "./parts-plan";

const A = "11222333000181";
const B = "99888777000166";
const raw = (cnpj: string, periodo: string, sizeBytes = 1000, name = "EFD.txt"): RawFile => ({
  key: `orgs/acme/clientes/c/fiscal/efd-icms-ipi/${cnpj}/${periodo}/${name}`, name, cnpj, periodo, sizeBytes, updatedAt: null,
});

describe("isFiscalPanel", () => {
  it("knows the panel's catalog id", () => {
    expect(isFiscalPanel("dados-fiscais")).toBe(true);
    expect(isFiscalPanel("efd-icms-ipi")).toBe(false);
  });
});

describe("spedFileStatuses", () => {
  const files = [raw(A, "2026-01"), raw(A, "2026-02"), raw(A, "2026-03", 900 * 1024 ** 2), raw(B, "2026-01")];

  it("tells read, missing, failed and too big for the app", () => {
    const states = spedFileStatuses(
      files, new Set([files[0].key]), new Map([[files[3].key, { error: "Arquivo sem 0000.", at: "t" }]]), 250 * 1024 ** 2,
    );
    expect(states.map((s) => s.state)).toEqual(["pronto", "falta", "script", "erro"]);
    expect(states[3].error).toBe("Arquivo sem 0000.");
  });

  it("a big file already read is ready, and without a limit (script, local server) nothing goes to the script", () => {
    const states = spedFileStatuses(files, new Set([files[2].key]), new Map(), 250 * 1024 ** 2);
    expect(states[2].state).toBe("pronto");
    expect(spedFileStatuses(files, new Set(), new Map(), null).map((s) => s.state)).toEqual(["falta", "falta", "falta", "falta"]);
  });

  it("NF-e files are only kept", () => {
    expect(documentFileStatuses([raw(A, "2026-01", 10, "n.xml")])[0].state).toBe("guardado");
  });
});

describe("fileMap", () => {
  it("has a row per company, every month between the first and the last, and the worst state per cell", () => {
    const statuses: FileStatus[] = [
      { ...raw(B, "2026-03"), state: "pronto" },
      { ...raw(A, "2025-11"), state: "pronto" },
      { ...raw(A, "2026-03", 10, "a.txt"), state: "pronto" },
      { ...raw(A, "2026-03", 20, "b.txt"), state: "erro" },
    ];
    const map = fileMap(statuses);
    expect(map.companies).toEqual([A, B]);
    expect(map.periods).toEqual(["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
    expect(map.cells[`${A}|2026-03`]).toEqual({ state: "erro", files: 2, sizeBytes: 30 });
    expect(map.cells[`${A}|2026-01`]).toBeUndefined();
    expect(fileMap([])).toEqual({ companies: [], periods: [], cells: {} });
  });
});

describe("monthsBetween", () => {
  it("crosses years and stops at a broken range", () => {
    expect(monthsBetween("2025-12", "2026-02")).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-02", "2025-12")).toEqual([]);
    expect(monthsBetween("1900-01", "2200-01")).toHaveLength(600);
  });
});

describe("countStates and filesToRead", () => {
  const statuses: FileStatus[] = [
    { ...raw(B, "2026-02"), state: "falta" },
    { ...raw(A, "2026-02"), state: "falta" },
    { ...raw(A, "2026-01"), state: "erro", error: "x" },
    { ...raw(A, "2025-12"), state: "pronto" },
    { ...raw(B, "2025-12"), state: "script" },
  ];

  it("counts each state", () => {
    expect(countStates(statuses)).toEqual({ pronto: 1, falta: 2, erro: 1, script: 1, guardado: 0 });
  });

  it("reads the missing ones oldest month first, and the failed ones only when asked", () => {
    expect(filesToRead(statuses, false).map((s) => `${s.cnpj.slice(0, 2)} ${s.periodo}`)).toEqual(["11 2026-02", "99 2026-02"]);
    expect(filesToRead(statuses, true).map((s) => s.periodo)).toEqual(["2026-01", "2026-02", "2026-02"]);
  });
});

describe("lineage on screen", () => {
  const table: TableLineage = {
    table: "paineis_todos_periodos", kind: "fact", how: ["Analíticos somados."], rows: 30,
    sources: [
      { file: "f/a.txt", cnpj: A, periodo: "2026-01", sizeBytes: 1, updatedAt: null, rows: 10 },
      { file: "f/b.txt", cnpj: A, periodo: "2026-03", sizeBytes: 1, updatedAt: null, rows: 10 },
      { file: "f/c.txt", cnpj: B, periodo: "2026-02", sizeBytes: 1, updatedAt: null, rows: 10 },
    ],
  };

  it("sums a table up: files, companies and months it came from", () => {
    expect(lineageTableView(table)).toEqual({
      table: "paineis_todos_periodos", kind: "fact", how: ["Analíticos somados."], rows: 30,
      files: 3, companies: 2, from: "2026-01", to: "2026-03",
    });
  });

  it("pages the sources, newest month first", () => {
    const page = lineageSourcesPage(table, 1, 1);
    expect(page.total).toBe(3);
    expect(page.sources.map((s) => s.file)).toEqual(["f/c.txt"]);
  });

  it("accepts a lineage and refuses a broken one", () => {
    const lineage = { dashboard: "d", template: "efd-icms-ipi", builtAt: "2026-11-13T10:00:00Z", reader: 3, tables: [table] };
    expect(parseLineage(JSON.parse(JSON.stringify(lineage)))).toEqual(lineage);
    expect(parseLineage({ ...lineage, reader: "3" })).toBeNull();
    expect(parseLineage({ ...lineage, tables: [{ ...table, sources: [{ file: 1 }] }] })).toBeNull();
    expect(parseLineage(null)).toBeNull();
  });
});
