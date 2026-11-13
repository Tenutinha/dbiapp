import { describe, expect, it } from "vitest";
import { formatValue } from "./format";

/** Intl puts a non-breaking space after "R$". */
const plain = (s: string): string => s.replace(/ /g, " ");

describe("formatValue", () => {
  it("rounds currency to whole reais, and shortens it only when asked", () => {
    expect(plain(formatValue(65769.15, "currency"))).toBe("R$ 65.769");
    expect(plain(formatValue(2_870_000, "currency", true))).toBe("R$ 2,87 mi");
  });

  it("keeps the cents of an exact currency without the symbol, also when a short form is asked", () => {
    expect(formatValue(65769.15, "currency_exact")).toBe("65.769,15");
    expect(formatValue(1085.2, "currency_exact")).toBe("1.085,20");
    expect(formatValue(0, "currency_exact")).toBe("0,00");
    expect(formatValue(-12.5, "currency_exact")).toBe("-12,50");
    expect(formatValue(250_780_080.08, "currency_exact", true)).toBe("250.780.080,08");
  });

  it("shortens counts only from a million up, and only when asked", () => {
    expect(formatValue(2_842_551, "integer")).toBe("2.842.551");
    expect(plain(formatValue(2_842_551, "integer", true))).toBe("2,84 mi");
    expect(formatValue(842_339, "integer", true)).toBe("842.339");
    expect(plain(formatValue(1_500_000.5, "number", true))).toBe("1,5 mi");
  });

  it("shows a dash for a missing value and leaves text as it is", () => {
    expect(formatValue(null, "currency_exact")).toBe("—");
    expect(formatValue("Tributada", "text")).toBe("Tributada");
  });
});
