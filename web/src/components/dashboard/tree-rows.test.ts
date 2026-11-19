import { describe, expect, it } from "vitest";
import { buildTree, initialOpen, visibleRows } from "./tree-rows";

const levels = ["g1", "g2", "conta"];
const rows = [
  { g1: "ATIVO", g2: "CIRCULANTE", conta: "10090 - Banco", sf: 100, d: 10 },
  { g1: "ATIVO", g2: "CIRCULANTE", conta: "10010 - Caixa", sf: 50, d: "5" },
  { g1: "ATIVO", g2: "(sem cadastro)", conta: "10500 - Imobilizado", sf: 20, d: null },
  { g1: "PASSIVO", g2: "PASSIVO", conta: "20010 - Fornecedores", sf: -170, d: 0 },
];

describe("tree of a trial balance", () => {
  const tree = buildTree(levels, ["sf", "d"], rows);

  it("adds every leaf into its groups and the grand total", () => {
    expect(tree.total).toEqual([0, 15]);
    const ativo = tree.roots[0];
    expect(ativo).toMatchObject({ label: "ATIVO", values: [170, 15] });
    expect(ativo.children.find((c) => c.label === "CIRCULANTE")?.values).toEqual([150, 15]);
  });

  it("skips a level that is empty or repeats the one above", () => {
    const ativo = tree.roots[0];
    // The fixed asset has no level 2: it hangs right under ATIVO.
    expect(ativo.children.map((c) => c.label)).toContain("10500 - Imobilizado");
    expect(ativo.children.some((c) => c.label === "(sem cadastro)")).toBe(false);
    const passivo = tree.roots[1];
    expect(passivo.children.map((c) => c.label)).toEqual(["20010 - Fornecedores"]);
  });

  it("orders lines as the chart of accounts: by the first account code under them", () => {
    expect(tree.roots.map((n) => n.label)).toEqual(["ATIVO", "PASSIVO"]);
    const circ = tree.roots[0].children.find((c) => c.label === "CIRCULANTE")!;
    expect(circ.children.map((c) => c.label)).toEqual(["10010 - Caixa", "10090 - Banco"]);
    expect(tree.roots[0].children.map((c) => c.label)).toEqual(["CIRCULANTE", "10500 - Imobilizado"]);
  });

  it("shows the open lines only, and opens the first levels at first", () => {
    const open = initialOpen(tree.roots, 1);
    expect(visibleRows(tree.roots, open, "").map((r) => r.node.label)).toEqual([
      "ATIVO", "CIRCULANTE", "10500 - Imobilizado", "PASSIVO", "20010 - Fornecedores",
    ]);
    expect(visibleRows(tree.roots, new Set(), "").map((r) => r.node.label)).toEqual(["ATIVO", "PASSIVO"]);
  });

  it("finds a line by its text, opening what is above it", () => {
    const found = visibleRows(tree.roots, new Set(), "banco");
    expect(found.map((r) => r.node.label)).toEqual(["ATIVO", "CIRCULANTE", "10090 - Banco"]);
    expect(found[2]).toMatchObject({ depth: 2, match: true });
  });
});
