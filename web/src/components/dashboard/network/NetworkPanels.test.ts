import { describe, expect, it } from "vitest";
import { pluralKind } from "./NetworkPanels";

describe("pluralKind", () => {
  it("puts kinds of place in the plural", () => {
    expect(pluralKind("Filial", 3)).toBe("filiais");
    expect(pluralKind("Fornecedor", 2)).toBe("fornecedores");
    expect(pluralKind("Matriz", 1)).toBe("matriz");
    expect(pluralKind("Centro de distribuição", 4)).toBe("centros de distribuição");
    expect(pluralKind("Loja", 5)).toBe("lojas");
    expect(pluralKind("Armazém", 2)).toBe("armazém");
  });
});
