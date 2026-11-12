import { describe, expect, it } from "vitest";
import { filesForFact, parseMarker, partsFolderId, planParts, type PartsFolder, type PartsMarker, type RawFile } from "./parts-plan";

const file = (periodo: string, over: Partial<RawFile> = {}): RawFile => ({
  key: `orgs/acme/fiscal/efd-contribuicoes/11222333000181/${periodo}/PISCOFINS.txt`,
  name: "PISCOFINS.txt", cnpj: "11222333000181", periodo, sizeBytes: 1000, updatedAt: "2026-11-10T10:00:00.000Z", ...over,
});
const marker = (f: RawFile, tables: string[], reader = 1): PartsMarker => ({
  reader,
  source: { key: f.key, sizeBytes: f.sizeBytes, updatedAt: f.updatedAt },
  tables: Object.fromEntries(tables.map((t) => [t, { key: `${t}.parquet`, rows: 10 }])),
  dimensions: {},
});
const folderOf = (f: RawFile, tables: string[], reader = 1): PartsFolder => ({
  cnpj: f.cnpj, periodo: f.periodo, id: partsFolderId(f, reader), marker: marker(f, tables, reader),
});

describe("partsFolderId", () => {
  it("changes when the file is replaced or the reader changes, not otherwise", () => {
    const f = file("2026-07");
    expect(partsFolderId(f, 1)).toBe(partsFolderId({ ...f }, 1));
    expect(partsFolderId({ ...f, sizeBytes: 1001 }, 1)).not.toBe(partsFolderId(f, 1));
    expect(partsFolderId({ ...f, updatedAt: "2026-11-11T10:00:00.000Z" }, 1)).not.toBe(partsFolderId(f, 1));
    expect(partsFolderId(f, 2)).not.toBe(partsFolderId(f, 1));
    expect(partsFolderId(f, 1)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("planParts", () => {
  const tables = ["registros", "bloco_a"];

  it("reads every file the first time", () => {
    const files = [file("2026-06"), file("2026-07")];
    expect(planParts(files, [], tables, 1)).toEqual({ read: files, ready: [], obsolete: [] });
  });

  it("reads only the new month and reuses the others", () => {
    const june = file("2026-06");
    const july = file("2026-07");
    const plan = planParts([june, july], [folderOf(june, tables)], tables, 1);
    expect(plan.read).toEqual([july]);
    expect(plan.ready.map((r) => r.file)).toEqual([june]);
    expect(plan.obsolete).toEqual([]);
  });

  it("reads a replaced month again and drops its old parts", () => {
    const july = file("2026-07");
    const fixed = { ...july, sizeBytes: 2000, updatedAt: "2026-11-12T08:00:00.000Z" };
    const old = folderOf(july, tables);
    const plan = planParts([fixed], [old], tables, 1);
    expect(plan.read).toEqual([fixed]);
    expect(plan.obsolete).toEqual([old]);
  });

  it("reads again what an older reader produced or what misses a table the template now has", () => {
    const july = file("2026-07");
    expect(planParts([july], [folderOf(july, tables, 0)], tables, 1).read).toEqual([july]);
    expect(planParts([july], [folderOf(july, ["registros"])], tables, 1).read).toEqual([july]);
  });

  it("treats a folder without its marker (an interrupted read) as obsolete", () => {
    const july = file("2026-07");
    const interrupted: PartsFolder = { ...folderOf(july, tables), marker: null };
    const plan = planParts([july], [interrupted], tables, 1);
    expect(plan.read).toEqual([july]);
    expect(plan.obsolete).toEqual([interrupted]);
  });

  it("drops the parts of a file that was deleted", () => {
    const gone = folderOf(file("2025-01"), tables);
    expect(planParts([], [gone], tables, 1).obsolete).toEqual([gone]);
  });
});

describe("filesForFact", () => {
  const ready = [
    { file: file("2026-06") },
    { file: file("2026-07") },
    { file: file("2026-05", { cnpj: "99888777000166", key: "x" }) },
  ];

  it("keeps every period, or only each company's latest", () => {
    expect(filesForFact(ready, "all")).toHaveLength(3);
    expect(filesForFact(ready, "latest").map((r) => `${r.file.cnpj} ${r.file.periodo}`)).toEqual([
      "11222333000181 2026-07", "99888777000166 2026-05",
    ]);
  });
});

describe("parseMarker", () => {
  it("accepts a marker and refuses anything else", () => {
    const m = marker(file("2026-07"), ["registros"]);
    expect(parseMarker(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(parseMarker(null)).toBeNull();
    expect(parseMarker({ ...m, reader: "1" })).toBeNull();
    expect(parseMarker({ ...m, tables: { registros: { key: 1, rows: 1 } } })).toBeNull();
    expect(parseMarker({ ...m, dimensions: undefined })).toBeNull();
  });
});
