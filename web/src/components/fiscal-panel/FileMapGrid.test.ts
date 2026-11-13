import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fileMap, type FileStatus } from "@/lib/fiscal/panel";
import { FileMapGrid } from "./FileMapGrid";

const A = "11222333000181";
const status = (periodo: string, state: FileStatus["state"]): FileStatus => ({
  key: `k/${periodo}`, name: "EFD.txt", cnpj: A, periodo, sizeBytes: 1024, state,
});
const map = fileMap([status("2026-01", "pronto"), status("2026-03", "falta")]);

describe("FileMapGrid", () => {
  it("only shows the cells to who only views (no buttons)", () => {
    const html = renderToStaticMarkup(createElement(FileMapGrid, { map }));
    expect(html).not.toContain("<button");
    expect(html).toContain("01/2026: 1 arquivo(s)");
    expect(html).toContain("02/2026: sem arquivo");
  });

  it("makes each month with files a button for who reads, marking the chosen one and the one being read", () => {
    const html = renderToStaticMarkup(createElement(FileMapGrid, {
      map, onSelect: () => undefined, selected: `${A}|2026-03`, busy: `${A}|2026-03`,
    }));
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2); // the empty month stays a plain cell
    const chosen = buttons.find((b) => b.includes('aria-pressed="true"')) ?? "";
    expect(chosen).toContain("03/2026");
    expect(chosen).toContain("animate-pulse");
    expect(buttons.find((b) => b.includes("01/2026"))).toContain('aria-pressed="false"');
    expect(html).toContain("Clique para ver os arquivos e ler.");
  });
});
