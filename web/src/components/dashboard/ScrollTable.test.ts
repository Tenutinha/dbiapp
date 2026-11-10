import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nextSort, nextVisible, PAGE_SIZE, ScrollTable, sortOrder, type ScrollColumn } from "./ScrollTable";

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

describe("sortOrder", () => {
  const values = [["b", 2], ["a", 10], ["c", null], ["A2", 1]];

  it("sem classificação mantém a ordem original", () => {
    expect(sortOrder(values, null)).toEqual([0, 1, 2, 3]);
  });

  it("classifica números como números e deixa vazios por último", () => {
    expect(sortOrder(values, { column: 1, dir: "desc" })).toEqual([1, 0, 3, 2]);
    expect(sortOrder(values, { column: 1, dir: "asc" })).toEqual([3, 0, 1, 2]);
  });

  it("classifica texto sem diferenciar maiúsculas", () => {
    expect(sortOrder(values, { column: 0, dir: "asc" })).toEqual([1, 3, 0, 2]);
  });
});

describe("nextSort", () => {
  it("número começa do maior, texto de A; depois inverte e volta ao original", () => {
    const first = nextSort(null, 1, true);
    expect(first).toEqual({ column: 1, dir: "desc" });
    const second = nextSort(first, 1, true);
    expect(second).toEqual({ column: 1, dir: "asc" });
    expect(nextSort(second, 1, true)).toBeNull();
    expect(nextSort(second, 0, false)).toEqual({ column: 0, dir: "asc" });
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
