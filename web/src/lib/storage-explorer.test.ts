import { describe, expect, it } from "vitest";
import {
  canMoveTo,
  clientSlugOf,
  decorate,
  fileKind,
  isProtectedFolder,
  isSystemPath,
  joinPath,
  parentOf,
  renamedFileName,
  safeDroppedDir,
  safeFolderName,
  sortEntries,
  targetProblem,
  usageFor,
  type ExplorerEntry,
} from "./storage-explorer";

describe("fileKind", () => {
  it("names the type by extension, case-insensitively", () => {
    expect(fileKind("PISCOFINS_2026.TXT")).toEqual({ kind: "text", label: "Texto (SPED)", data: true });
    expect(fileKind("vendas.parquet").data).toBe(true);
    expect(fileKind("notas.xml")).toEqual({ kind: "xml", label: "XML", data: false });
    expect(fileKind("relatorio.xlsx").kind).toBe("excel");
    expect(fileKind("sem-extensao").kind).toBe("other");
  });
});

describe("clientSlugOf", () => {
  it("finds the client folder of a path relative to the organization", () => {
    expect(clientSlugOf("clientes/martinello")).toBe("martinello");
    expect(clientSlugOf("clientes/martinello/fiscal/2026")).toBe("martinello");
    expect(clientSlugOf("clientes")).toBeNull();
    expect(clientSlugOf("preparado/presidente")).toBeNull();
    expect(clientSlugOf("")).toBeNull();
  });
});

describe("paths", () => {
  it("joins and splits paths relative to the organization", () => {
    expect(joinPath("", "a.csv")).toBe("a.csv");
    expect(joinPath("clientes/x/", "a.csv")).toBe("clientes/x/a.csv");
    expect(parentOf("clientes/x/a.csv")).toBe("clientes/x");
    expect(parentOf("a.csv")).toBe("");
  });

  it("protects the clients root and each client folder", () => {
    expect(isProtectedFolder("")).toBe(true);
    expect(isProtectedFolder("clientes")).toBe(true);
    expect(isProtectedFolder("clientes/martinello")).toBe(true);
    expect(isProtectedFolder("clientes/martinello/2026")).toBe(false);
    expect(isProtectedFolder("preparado")).toBe(false);
  });
});

describe("safeFolderName", () => {
  it("keeps simple names and cleans the rest", () => {
    expect(safeFolderName("Notas 2026")).toBe("Notas-2026");
    expect(safeFolderName("  março/abril ")).toBe("marco-abril");
    expect(safeFolderName("..")).toBeNull();
    expect(safeFolderName("   ")).toBeNull();
  });
});

describe("renamedFileName", () => {
  it("cleans the new name and keeps the original extension", () => {
    expect(renamedFileName("PISCOFINS.txt", "Julho 2026")).toBe("Julho-2026.txt");
    expect(renamedFileName("PISCOFINS.txt", "julho.txt")).toBe("julho.txt");
    expect(renamedFileName("PISCOFINS.txt", "julho.csv")).toBe("julho.csv.txt");
    expect(renamedFileName("PISCOFINS.txt", "  ")).toBeNull();
  });
});

describe("canMoveTo", () => {
  it("refuses moving into the same folder, into itself or a protected folder", () => {
    expect(canMoveTo({ path: "clientes/x/a.csv", folder: false }, "clientes/x")).toBe("Já está nessa pasta.");
    expect(canMoveTo({ path: "lotes", folder: true }, "lotes/2026")).toBe("Uma pasta não pode ir para dentro dela mesma.");
    expect(canMoveTo({ path: "clientes/x", folder: true }, "arquivo")).toBe("Pastas de cliente não podem ser movidas.");
    expect(canMoveTo({ path: "clientes/x/a.csv", folder: false }, "clientes/y")).toBeNull();
    expect(canMoveTo({ path: "lotes", folder: true }, "clientes/y")).toBeNull();
  });
});

describe("usageFor", () => {
  const uses = [
    { file: "PISCOFINS.txt", clientSlug: "martinello", dashboard: "EFD Contribuições", state: "active" as const },
    { file: "PISCOFINS.txt", clientSlug: "davos-sa", dashboard: "EFD Contribuições", state: "draft" as const },
    { file: "f_vendas.parquet", clientSlug: null, dashboard: "Vendas", state: "active" as const },
  ];

  it("matches by name inside the client's folder (any depth)", () => {
    expect(usageFor(uses, "clientes/martinello/2026", "PISCOFINS.txt")).toEqual([{ dashboard: "EFD Contribuições", state: "active" }]);
  });

  it("matches organization dashboards outside the clients folder", () => {
    expect(usageFor(uses, "preparado", "f_vendas.parquet")).toEqual([{ dashboard: "Vendas", state: "active" }]);
    expect(usageFor(uses, "clientes/martinello", "f_vendas.parquet")).toEqual([]);
  });
});

describe("sortEntries", () => {
  const entries: ExplorerEntry[] = [
    { name: "b.csv", path: "b.csv", folder: false, sizeBytes: 10, updatedAt: "2026-11-02T00:00:00Z" },
    { name: "zeta", path: "zeta", folder: true, sizeBytes: 0, updatedAt: null },
    { name: "A.txt", path: "A.txt", folder: false, sizeBytes: 30, updatedAt: "2026-11-01T00:00:00Z" },
  ];

  it("keeps folders first and sorts files by the chosen column", () => {
    expect(sortEntries(entries, "name", "asc").map((e) => e.name)).toEqual(["zeta", "A.txt", "b.csv"]);
    expect(sortEntries(entries, "size", "desc").map((e) => e.name)).toEqual(["zeta", "A.txt", "b.csv"]);
    expect(sortEntries(entries, "updated", "desc").map((e) => e.name)).toEqual(["zeta", "b.csv", "A.txt"]);
  });

  it("does not change the input", () => {
    const copy = [...entries];
    sortEntries(entries, "name", "desc");
    expect(entries).toEqual(copy);
  });
});

describe("targetProblem", () => {
  const clients = new Set(["martinello"]);

  it("allows the organization's folders and real client folders", () => {
    expect(targetProblem("", clients)).toBeNull();
    expect(targetProblem("lotes/2026", clients)).toBeNull();
    expect(targetProblem("clientes/martinello/2026", clients)).toBeNull();
  });

  it("refuses the clients root and folders of clients that do not exist", () => {
    expect(targetProblem("clientes", clients)).toBe("Dentro de “clientes” só ficam as pastas dos clientes. Escolha a pasta de um cliente.");
    expect(targetProblem("clientes/inventado", clients)).toBe("“inventado” não é um cliente desta organização.");
  });
});

describe("safeDroppedDir", () => {
  it("cleans every level of a dropped folder's path", () => {
    expect(safeDroppedDir("Notas Julho/Março")).toBe("Notas-Julho/Marco");
    expect(safeDroppedDir("")).toBe("");
    expect(safeDroppedDir("../x")).toBe("x");
  });
});

describe("system folders", () => {
  it("marks the platform's own folders (datasets, uploads, branding) at the organization root", () => {
    expect(isSystemPath("datasets")).toBe(true);
    expect(isSystemPath("datasets/abc/v1/x.parquet")).toBe(true);
    expect(isSystemPath("branding")).toBe(true);
    expect(isSystemPath("uploads/x")).toBe(true);
    expect(isSystemPath("clientes/martinello/datasets")).toBe(false);
    expect(isSystemPath("lotes")).toBe(false);
  });

  it("protects them and refuses them as targets", () => {
    expect(isProtectedFolder("datasets")).toBe(true);
    expect(canMoveTo({ path: "datasets/x.parquet", folder: false }, "lotes")).toBe("Esta pasta é da plataforma e não pode ser alterada.");
    expect(targetProblem("branding", new Set())).toBe("Esta pasta é da plataforma e não pode ser alterada.");
  });
});

describe("decorate", () => {
  it("adds the client name and the dashboards that used each file", () => {
    const meta = {
      clients: [{ slug: "martinello", name: "Martinello" }],
      uses: [{ file: "a.txt", clientSlug: "martinello", dashboard: "EFD", state: "active" as const }],
    };
    const entries: ExplorerEntry[] = [
      { name: "fiscal", path: "clientes/martinello/fiscal", folder: true, sizeBytes: 0, updatedAt: null },
      { name: "a.txt", path: "clientes/martinello/a.txt", folder: false, sizeBytes: 3, updatedAt: null },
    ];
    expect(decorate(entries, "clientes/martinello", meta)).toEqual([
      { ...entries[0], client: "Martinello", usedIn: [] },
      { ...entries[1], client: "Martinello", usedIn: [{ dashboard: "EFD", state: "active" }] },
    ]);
    expect(decorate(entries, "clientes/martinello", null)[1]).toEqual({ ...entries[1], client: "martinello", usedIn: [] });
  });
});
