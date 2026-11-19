import { describe, expect, it } from "vitest";
import { nextPeriod, periodLabels, periodsOf } from "./network-timeline";

describe("periodLabels", () => {
  it("names months in Portuguese and leaves other periods as they are", () => {
    expect(periodLabels("2026-03")).toEqual({ label: "mar/26", title: "março de 2026" });
    expect(periodLabels("2025-12")).toEqual({ label: "dez/25", title: "dezembro de 2025" });
    expect(periodLabels("2026")).toEqual({ label: "2026", title: "2026" });
    expect(periodLabels("2026-13")).toEqual({ label: "2026-13", title: "2026-13" });
  });
});

describe("periodsOf", () => {
  it("lists the periods in order with the total of each", () => {
    const rows = [
      { mes: "2026-02", valor: 10 }, { mes: "2026-01", valor: "5" }, { mes: "2026-02", valor: 2.5 }, { mes: null, valor: 99 },
    ];
    expect(periodsOf(rows, "mes", "valor")).toEqual([
      { key: "2026-01", total: 5, label: "jan/26", title: "janeiro de 2026" },
      { key: "2026-02", total: 12.5, label: "fev/26", title: "fevereiro de 2026" },
    ]);
  });
});

describe("nextPeriod", () => {
  const periods = periodsOf([{ m: "a", v: 1 }, { m: "b", v: 1 }], "m", "v");
  it("starts at the first, follows the order and stops after the last", () => {
    expect(nextPeriod(periods, null)).toBe("a");
    expect(nextPeriod(periods, "a")).toBe("b");
    expect(nextPeriod(periods, "b")).toBeNull();
    expect(nextPeriod([], null)).toBeNull();
  });
});
