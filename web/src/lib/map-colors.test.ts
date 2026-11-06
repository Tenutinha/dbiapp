import { describe, expect, it } from "vitest";
import { categoryLegend, MIN_STRENGTH_WEIGHT, mix, parseHex, scaleRange, strengthWeights } from "./map-colors";

describe("parseHex", () => {
  it("accepts #rrggbb and rejects anything else", () => {
    expect(parseHex("#c8102e")).toEqual([200, 16, 46]);
    expect(parseHex("red")).toBeNull();
    expect(parseHex("#fff")).toBeNull();
    expect(parseHex(null)).toBeNull();
  });
});

describe("mix", () => {
  it("goes from base (0) to colour (1)", () => {
    expect(mix("#ff0000", "#ffffff", 1)).toBe("#ff0000");
    expect(mix("#ff0000", "#ffffff", 0)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("uses the fallback for invalid data colours", () => {
    expect(mix("javascript:alert(1)", "#000000", 1, "#123456")).toBe("#123456");
  });
});

describe("strengthWeights", () => {
  it("scales between the minimum weight and 1", () => {
    const w = strengthWeights([0.4, 0.5, 0.6, 0.7, 0.8, null]);
    expect(Math.min(...w)).toBeCloseTo(MIN_STRENGTH_WEIGHT);
    expect(Math.max(...w)).toBe(1);
    expect(w[5]).toBe(1);
  });

  it("returns full weight when every value is equal", () => {
    expect(strengthWeights([0.5, 0.5])).toEqual([1, 1]);
  });
});

describe("categoryLegend", () => {
  it("orders categories by frequency", () => {
    const legend = categoryLegend([
      { label: "B", color: "#000002" },
      { label: "A", color: "#000001" },
      { label: "B", color: "#000002" },
    ]);
    expect(legend.map((l) => [l.label, l.count])).toEqual([["B", 2], ["A", 1]]);
  });
});

describe("scaleRange", () => {
  it("is symmetric for diverging scales", () => {
    expect(scaleRange([-0.1, 0.05, 0.3], true)).toEqual({ min: -0.3, max: 0.3 });
  });

  it("never returns an empty range", () => {
    expect(scaleRange([2, 2], false)).toEqual({ min: 2, max: 3 });
  });
});
