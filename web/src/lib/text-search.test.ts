import { describe, expect, it } from "vitest";
import { foldText, matchesQuery } from "./text-search";

describe("foldText", () => {
  it("lowercases, strips accents and trims", () => {
    expect(foldText("  Votação ÁREA ")).toBe("votacao area");
  });
});

describe("matchesQuery", () => {
  const text = "NF-e Notas fiscais eletrônicas Fiscal Rascunho";

  it("matches everything for an empty query", () => {
    expect(matchesQuery(text, "   ")).toBe(true);
  });

  it("ignores accents and case", () => {
    expect(matchesQuery(text, "ELETRONICAS")).toBe(true);
  });

  it("needs every word of the query, in any order", () => {
    expect(matchesQuery(text, "rascunho fiscal")).toBe(true);
    expect(matchesQuery(text, "fiscal publicado")).toBe(false);
  });
});
