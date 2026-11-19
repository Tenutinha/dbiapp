import { describe, expect, it } from "vitest";
import { shareOfFirst, waterfallBars } from "./waterfall-steps";

const ITEMS = [
  { measure: "rb", label: "Receita bruta", total: true },
  { measure: "ded", label: "Deduções" },
  { measure: "rl", label: "Receita líquida", total: true },
  { measure: "custo", label: "Custos" },
  { measure: "fin", label: "Financeiro" },
  { measure: "lucro", label: "Lucro", total: true },
];

describe("waterfallBars", () => {
  it("stands each total on zero and hangs each step from where the one before ended", () => {
    const bars = waterfallBars(ITEMS, { rb: 100, ded: -10, rl: "90", custo: -60, fin: 5, lucro: 35 });
    expect(bars.map((b) => [b.kind, b.start, b.end])).toEqual([
      ["total", 0, 100], ["down", 100, 90], ["total", 0, 90], ["down", 90, 30], ["up", 30, 35], ["total", 0, 35],
    ]);
    expect(shareOfFirst(bars, bars[3])).toBeCloseTo(-0.6);
  });

  it("goes below zero when the result is a loss, and reads a missing value as zero", () => {
    const bars = waterfallBars(ITEMS, { rb: 100, ded: -10, rl: 90, custo: -120, fin: null, lucro: -30 });
    expect(bars.slice(3).map((b) => [b.kind, b.start, b.end])).toEqual([["down", 90, -30], ["up", -30, -30], ["total", 0, -30]]);
    expect(waterfallBars(ITEMS, undefined).every((b) => b.value === 0)).toBe(true);
    expect(shareOfFirst(waterfallBars(ITEMS, undefined), waterfallBars(ITEMS, undefined)[1])).toBeNull();
  });
});
