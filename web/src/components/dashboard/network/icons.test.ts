import { describe, expect, it } from "vitest";
import { ICON_SHAPES, iconOf, iconShape, iconSvg } from "./icons";

describe("iconShape", () => {
  it("draws each kind of place by the words in it", () => {
    expect(iconShape("Matriz")).toBe("tower");
    expect(iconShape("Filial")).toBe("store");
    expect(iconShape("Loja")).toBe("store");
    expect(iconShape("Fornecedor")).toBe("factory");
    expect(iconShape("Indústria")).toBe("factory");
    expect(iconShape("Centro de distribuição")).toBe("warehouse");
    expect(iconShape("CD")).toBe("warehouse");
    expect(iconShape("Depósito")).toBe("warehouse");
    expect(iconShape("Cidade com clientes")).toBe("people");
    expect(iconShape("Clientes (por cidade)")).toBe("people");
    expect(iconShape("Cliente PJ")).toBe("building");
    expect(iconShape("Parceiro")).toBe("building");
  });
});

describe("drawings", () => {
  it("every drawing is a square SVG path, white for the map", () => {
    for (const shape of ICON_SHAPES) {
      const svg = iconSvg(shape);
      expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 64 64"/);
      expect(svg).toContain('fill="#ffffff"');
      expect(svg).not.toMatch(/NaN|undefined/);
    }
  });

  it("is tinted by the map and stands on its bottom edge", () => {
    expect(iconOf("store")).toMatchObject({ id: "store", width: 64, height: 64, anchorY: 64, mask: true });
    expect(iconOf("store").url).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  });
});
