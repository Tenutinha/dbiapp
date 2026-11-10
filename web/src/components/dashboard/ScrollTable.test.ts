import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nextVisible, PAGE_SIZE, ScrollTable, type ScrollColumn } from "./ScrollTable";

const columns: ScrollColumn[] = [
  { label: "Cliente", headClass: "", cellClass: "" },
  { label: "Valor", headClass: "text-right", cellClass: "text-right" },
];
const rowsOf = (n: number): string[][] => Array.from({ length: n }, (_, i) => [`cliente-${i + 1}`, String(i + 1)]);

describe("nextVisible", () => {
  it("avança de 25 em 25", () => {
    expect(PAGE_SIZE).toBe(25);
    expect(nextVisible(25, 200)).toBe(50);
    expect(nextVisible(50, 200)).toBe(75);
  });

  it("não passa do total", () => {
    expect(nextVisible(175, 190)).toBe(190);
    expect(nextVisible(190, 190)).toBe(190);
  });
});

describe("ScrollTable", () => {
  it("desenha só as primeiras 25 linhas e diz quantas existem", () => {
    const html = renderToStaticMarkup(createElement(ScrollTable, { columns, rows: rowsOf(60) }));
    expect(html).toContain("cliente-25");
    expect(html).not.toContain("cliente-26");
    expect(html).toContain("25 de 60 linhas");
  });

  it("com poucas linhas mostra todas, sem contador", () => {
    const html = renderToStaticMarkup(createElement(ScrollTable, { columns, rows: rowsOf(7) }));
    expect(html).toContain("cliente-7");
    expect(html).not.toContain("linhas");
  });

  it("mostra a observação quando todas as linhas já estão na tela", () => {
    const html = renderToStaticMarkup(createElement(ScrollTable, { columns, rows: rowsOf(3), note: "Use os filtros." }));
    expect(html).toContain("Use os filtros.");
  });
});
