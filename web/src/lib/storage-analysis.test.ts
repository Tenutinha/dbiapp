import { describe, expect, it } from "vitest";
import type { TemplateTable } from "./templates/schema";
import {
  fiscalStandardFolder,
  isStale,
  judge,
  parseCsvHeader,
  resolveCopies,
  type FileFacts,
  type SpaceDashboard,
} from "./storage-analysis";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("parseCsvHeader", () => {
  it("reads the first line with the most likely separator", () => {
    expect(parseCsvHeader(enc("cnpj;periodo;valor\n1;2;3\n"))).toEqual(["cnpj", "periodo", "valor"]);
    expect(parseCsvHeader(enc("a,b,c\r\n1,2,3"))).toEqual(["a", "b", "c"]);
    expect(parseCsvHeader(enc("a\tb\n"))).toEqual(["a", "b"]);
    expect(parseCsvHeader(enc("a|b|c"))).toEqual(["a", "b", "c"]);
  });

  it("handles a BOM, quotes and separators inside quotes", () => {
    expect(parseCsvHeader(enc('﻿"Valor; líquido";"Data"\n'))).toEqual(["Valor; líquido", "Data"]);
    expect(parseCsvHeader(enc('"a ""b""",c\n'))).toEqual(['a "b"', "c"]);
  });

  it("returns nothing for empty or binary content", () => {
    expect(parseCsvHeader(enc(""))).toEqual([]);
    expect(parseCsvHeader(new Uint8Array([0, 1, 2, 0, 3]))).toEqual([]);
  });
});

const table = (name: string, cols: [string, boolean][]): TemplateTable =>
  ({ name, kind: "fact", description: "", columns: cols.map(([n, required]) => ({ name: n, type: "text", required })) }) as unknown as TemplateTable;

const space: SpaceDashboard[] = [
  {
    name: "EFD Contribuições",
    templateId: "efd-contribuicoes",
    tables: [table("itens", [["codigo", true], ["descricao", true], ["ncm", false]]), table("participantes", [["cod_part", true], ["nome", true]])],
  },
];

describe("judge", () => {
  it("says a table file is ready for the tables whose required columns it has", () => {
    const facts: FileFacts = { v: 1, kind: "table", format: "csv", columns: ["Código", "Descrição", "Unidade"] };
    expect(judge(facts, "clientes/x/itens.csv", space)).toMatchObject({
      status: "ready",
      layout: "CSV · 3 colunas",
      readyFor: [{ dashboard: "EFD Contribuições", table: "itens" }],
    });
  });

  it("names the closest table and what is missing when nothing fits", () => {
    const facts: FileFacts = { v: 1, kind: "table", format: "csv", columns: ["codigo", "preco"] };
    expect(judge(facts, "x.csv", space)).toMatchObject({
      status: "treatment",
      closest: { dashboard: "EFD Contribuições", table: "itens", missing: ["descricao"] },
    });
  });

  it("sends recognized fiscal files to the space's dashboard of that kind, and flags them out of place", () => {
    const facts: FileFacts = {
      v: 1, kind: "fiscal", templateId: "efd-contribuicoes", title: "EFD Contribuições",
      cnpj: "32951535000134", periodo: "2026-07", documentId: "efd-contribuicoes", label: "Martinello · 2026-07",
    };
    const loose = judge(facts, "clientes/x/PISCOFINS.txt", space);
    expect(loose).toMatchObject({ status: "treatment", layout: "EFD Contribuições · 32.951.535/0001-34 · 07/2026", buildIn: ["EFD Contribuições"], inStandard: false });
    expect(judge(facts, "clientes/x/fiscal/efd-contribuicoes/32951535000134/2026-07/a.txt", space).inStandard).toBe(true);
    expect(judge(facts, "clientes/x/a.txt", []).detail).toBe("Nenhum dashboard EFD Contribuições neste espaço. Fora da pasta padrão (use \"Organizar pasta\").");
  });

  it("labels documents, unknown files and big parquet", () => {
    expect(judge({ v: 1, kind: "document" }, "a.pdf", space).status).toBe("document");
    expect(judge({ v: 1, kind: "unknown", format: "txt" }, "a.txt", space).status).toBe("unknown");
    expect(judge({ v: 1, kind: "deferred", format: "parquet" }, "a.parquet", space).status).toBe("deferred");
  });
});

describe("fiscalStandardFolder", () => {
  it("is the space's fiscal/<molde>/<cnpj>/<periodo> folder, relative to the organization", () => {
    expect(fiscalStandardFolder("clientes/martinello/lotes", "efd-icms-ipi", "123", "2026-01")).toBe("clientes/martinello/fiscal/efd-icms-ipi/123/2026-01");
    expect(fiscalStandardFolder("lotes/2026", "nfe", "9", "2025-12")).toBe("fiscal/nfe/9/2025-12");
  });
});

describe("isStale", () => {
  it("asks for a new analysis when the file changed", () => {
    const at = "2026-11-10T10:00:00.000Z";
    expect(isStale({ sizeBytes: 10, updatedAt: at }, { sizeBytes: 10, updatedAt: at })).toBe(false);
    expect(isStale({ sizeBytes: 10, updatedAt: at }, { sizeBytes: 11, updatedAt: at })).toBe(true);
    expect(isStale({ sizeBytes: 10, updatedAt: at }, { sizeBytes: 10, updatedAt: "2026-11-10T11:00:00.000Z" })).toBe(true);
    expect(isStale(undefined, { sizeBytes: 10, updatedAt: at })).toBe(true);
  });
});

describe("resolveCopies", () => {
  const at = (d: string): string => `2026-01-${d}T00:00:00.000Z`;

  it("suggests every move without competition", () => {
    const out = resolveCopies([{ path: "a.txt", to: "f/1", documentId: "x", updatedAt: at("01") }], new Map());
    expect(out).toEqual([{ suggested: true, replaces: false }]);
  });

  it("keeps only the newest loose copy of the same document", () => {
    const out = resolveCopies(
      [
        { path: "orig.txt", to: "f/1", documentId: "x", updatedAt: at("01") },
        { path: "retif.txt", to: "f/1", documentId: "x", updatedAt: at("05") },
        { path: "outro.txt", to: "f/2", documentId: "x", updatedAt: at("02") },
      ],
      new Map(),
    );
    expect(out[0]).toMatchObject({ suggested: false, replaces: false, note: "Há uma cópia mais nova deste documento: retif.txt." });
    expect(out[1]).toEqual({ suggested: true, replaces: false });
    expect(out[2]).toEqual({ suggested: true, replaces: false });
  });

  it("replaces a filed copy only when the loose one is newer", () => {
    // The SPED already filed keeps its own name: any .txt in the period folder is the same document.
    const filed = new Map([["f/1", [{ name: "PISCOFINS_original.txt", updatedAt: at("03") }]]]);
    expect(resolveCopies([{ path: "novo.txt", to: "f/1", documentId: "x", updatedAt: at("09") }], filed)[0]).toEqual({ suggested: true, replaces: true });
    expect(resolveCopies([{ path: "velho.txt", to: "f/1", documentId: "x", updatedAt: at("01") }], filed)[0]).toMatchObject({
      suggested: false,
      replaces: true,
      note: "A cópia já arquivada é mais nova; organizar esta a substituiria.",
    });
  });
});

describe("judge (repeated columns)", () => {
  it("never calls ready a file whose headers repeat once normalized (the engate would refuse it)", () => {
    const facts: FileFacts = { v: 1, kind: "table", format: "csv", columns: ["codigo", "Código", "descricao"] };
    expect(judge(facts, "x.csv", space)).toMatchObject({ status: "treatment", detail: "Colunas repetidas: codigo, Código." });
  });
});
