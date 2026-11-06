import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { castSelect, matchColumns, normalizeName } from "./contract";

const produto = loadTemplate("vendas-executivo").tables.find((t) => t.name === "dim_produto")!;

describe("normalizeName", () => {
  it.each([
    ["Valor Líquido", "valor_liquido"],
    ["  ID_Produto ", "id_produto"],
    ["Região/UF", "regiao_uf"],
  ])("%s → %s", (input, expected) => expect(normalizeName(input)).toBe(expected));
});

describe("matchColumns", () => {
  it("maps headers ignoring case and accents", () => {
    const m = matchColumns(produto, [
      { name: "ID_PRODUTO", type: "BIGINT" },
      { name: "Produto", type: "VARCHAR" },
      { name: "Categoria", type: "VARCHAR" },
      { name: "Marca", type: "VARCHAR" },
    ]);
    expect(m.errors).toEqual([]);
    expect(m.mapping.find((c) => c.target === "id_produto")?.source).toBe("ID_PRODUTO");
  });

  it("errors on missing required columns and warns on missing optional / extra ones", () => {
    const m = matchColumns(produto, [
      { name: "id_produto", type: "BIGINT" },
      { name: "produto", type: "VARCHAR" },
      { name: "cor", type: "VARCHAR" },
    ]);
    expect(m.errors).toEqual(['Coluna obrigatória "categoria" não encontrada.']);
    expect(m.warnings.join(" ")).toContain("marca");
    expect(m.warnings.join(" ")).toContain("cor");
  });
});

describe("matchColumns header collisions", () => {
  it("rejects two headers that normalise to the same name", () => {
    const m = matchColumns(produto, [
      { name: "id_produto", type: "VARCHAR" },
      { name: "Categoria", type: "VARCHAR" },
      { name: "categoria ", type: "VARCHAR" },
    ]);
    expect(m.errors).toHaveLength(1);
    expect(m.errors[0]).toContain('"Categoria"');
  });
});

describe("castSelect", () => {
  it("casts to contract types and fills missing optional columns with NULL", () => {
    const sqlText = castSelect([
      { target: "id_produto", source: 'Id "x"', type: "integer" },
      { target: "marca", source: null, type: "text" },
    ]);
    expect(sqlText).toBe('TRY_CAST("Id ""x""" AS BIGINT) AS id_produto, CAST(NULL AS VARCHAR) AS marca');
  });
});
