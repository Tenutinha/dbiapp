import { describe, expect, it } from "vitest";
import type { StatementVisual } from "../templates/schema";
import { buildStatement, openableKeys, openingPath, visibleNodes } from "./tree";

const MISSING = "(sem cadastro)";
const visual: Pick<StatementVisual, "lines" | "levels" | "column" | "measure" | "base"> = {
  measure: "valor",
  column: "mes",
  levels: ["grupo", "sintetica", "conta"],
  base: "receita_liquida",
  lines: [
    { id: "receita_bruta", label: "Receita bruta", icon: "receita", where: "x" },
    { id: "deducoes", label: "(-) Deduções", icon: "deducao", where: "x" },
    { id: "receita_liquida", label: "Receita líquida", sum: ["receita_bruta", "deducoes"] },
    { id: "custos", label: "(-) Custos", where: "x" },
    { id: "lucro_bruto", label: "Lucro bruto", icon: "lucro", sum: ["receita_liquida", "custos"] },
    { id: "outras", label: "Outras contas", where: "x", optional: true },
  ],
};
const row = (line: string | null, mes: string, conta: string, valor: number, grupo = "G", sintetica = "S"): Record<string, unknown> => (
  { statement_line: line, mes, grupo, sintetica, conta, valor }
);
const opts = { lineColumn: "statement_line", missing: MISSING };

describe("openingPath", () => {
  it("leaves out missing values and a value equal to the one above", () => {
    expect(openingPath({ a: "G", b: "G", c: "C" }, ["a", "b", "c"], MISSING)).toEqual(["G", "C"]);
    expect(openingPath({ a: MISSING, b: null, c: "C" }, ["a", "b", "c"], MISSING)).toEqual(["C"]);
  });
});

describe("buildStatement", () => {
  const rows = [
    row("receita_bruta", "2025-01", "1 - Vendas", 1000),
    row("receita_bruta", "2025-02", "1 - Vendas", 500),
    row("receita_bruta", "2025-02", "2 - Serviços", 100),
    row("deducoes", "2025-01", "3 - ICMS", -200),
    row("custos", "2025-01", "4 - CMV", -300, "Custos", "CMV"),
    row(null, "2025-01", "9 - Fora", 999),
  ];

  it("puts the periods in columns, with a total at the end", () => {
    const s = buildStatement(visual, rows, opts);
    expect(s.columns).toEqual(["2025-01", "2025-02", "Total"]);
    expect(s.lines.find((l) => l.key === "receita_bruta")?.values).toEqual([1000, 600, 1600]);
  });

  it("adds up subtotals from earlier lines and ignores rows no line took", () => {
    const s = buildStatement(visual, rows, opts);
    const get = (k: string): number[] | undefined => s.lines.find((l) => l.key === k)?.values;
    expect(get("receita_liquida")).toEqual([800, 600, 1400]);
    expect(get("lucro_bruto")).toEqual([500, 600, 1100]);
    expect(s.lines.find((l) => l.key === "lucro_bruto")).toMatchObject({ kind: "total", icon: "lucro" });
  });

  it("leaves out an optional group line with no rows", () => {
    expect(buildStatement(visual, rows, opts).lines.map((l) => l.key)).not.toContain("outras");
  });

  it("shows each value as a share of the base line of its column", () => {
    const s = buildStatement(visual, rows, opts);
    expect(s.lines.find((l) => l.key === "custos")?.shares).toEqual([-300 / 800, 0, -300 / 1400]);
    expect(s.lines.find((l) => l.key === "receita_liquida")?.shares).toEqual([1, 1, 1]);
  });

  it("opens a group line down its levels, accounts sorted by code", () => {
    const s = buildStatement(visual, rows, opts);
    const receita = s.lines.find((l) => l.key === "receita_bruta");
    const sintetica = receita?.children[0]?.children[0];
    expect(receita?.children.map((c) => c.label)).toEqual(["G"]);
    expect(sintetica?.label).toBe("S");
    expect(sintetica?.children.map((c) => [c.label, c.values, c.depth])).toEqual([
      ["1 - Vendas", [1000, 500, 1500], 3],
      ["2 - Serviços", [0, 100, 100], 3],
    ]);
  });

  it("leaves out accounts that added nothing in every period", () => {
    const s = buildStatement(visual, [...rows, row("custos", "2025-02", "5 - Zero", 0, "Custos", "CMV")], opts);
    const cmv = s.lines.find((l) => l.key === "custos")?.children[0]?.children[0];
    expect(cmv?.children.map((c) => c.label)).toEqual(["4 - CMV"]);
  });

  it("adds the months up by year", () => {
    const s = buildStatement(visual, [...rows, row("receita_bruta", "2026-01", "1 - Vendas", 50)], { ...opts, period: "year" });
    expect(s.columns).toEqual(["2025", "2026", "Total"]);
    expect(s.lines.find((l) => l.key === "receita_bruta")?.values).toEqual([1600, 50, 1650]);
  });

  it("has a single column and no total for one period, and no share without a base", () => {
    const s = buildStatement({ ...visual, base: undefined }, [row("receita_bruta", "2025-12", "1 - Vendas", 10)], opts);
    expect(s.columns).toEqual(["2025-12"]);
    expect(s.lines[0]).toMatchObject({ values: [10], shares: [null] });
  });
});

describe("visibleNodes", () => {
  it("shows the children of open nodes only", () => {
    const s = buildStatement(visual, [row("receita_bruta", "2025-01", "1 - Vendas", 10)], opts);
    expect(visibleNodes(s.lines, new Set()).length).toBe(s.lines.length);
    const all = new Set(openableKeys(s.lines));
    expect(visibleNodes(s.lines, all).map((n) => n.label)).toContain("1 - Vendas");
    expect(all.size).toBe(3);
  });
});
