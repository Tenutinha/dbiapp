import { describe, expect, it } from "vitest";
import { formatMoney, lineTotal, moneyInput, parseMoney, parseQuantity, reaisToCents, sumCents } from "./money";

describe("parseMoney", () => {
  it.each([
    ["12,50", 1250],
    ["12.50", 1250],
    ["12", 1200],
    ["R$ 1.234,56", 123456],
    ["1.234", 123400],
    ["1,234.56", 123456],
    ["0,5", 50],
    [" 7,9 ", 790],
    ["0", 0],
  ])("%s → %d centavos", (text, cents) => expect(parseMoney(text)).toBe(cents));

  it.each(["", "abc", "-5", "R$", "999999999999"])("recusa %s", (text) => expect(parseMoney(text)).toBeNull());
});

describe("parseQuantity", () => {
  it.each([
    ["1", 1],
    ["1,5", 1.5],
    ["0.250", 0.25],
    ["1,234", 1.234],
    ["12", 12],
  ])("%s → %d", (text, n) => expect(parseQuantity(text)).toBe(n));

  it.each(["", "0", "-1", "x"])("recusa %s", (text) => expect(parseQuantity(text)).toBeNull());
});

describe("valores", () => {
  it("formata em reais com centavos", () => {
    expect(formatMoney(1250).replace(/\s/g, " ")).toBe("R$ 12,50");
    expect(moneyInput(1250)).toBe("12,50");
    expect(moneyInput(null)).toBe("");
  });

  it("converte reais em centavos sem erro de ponto flutuante", () => {
    expect(reaisToCents(19.99)).toBe(1999);
    expect(reaisToCents(0.1 + 0.2)).toBe(30);
    expect(reaisToCents(-1)).toBeNull();
    expect(reaisToCents(null)).toBeNull();
    expect(reaisToCents(Number.NaN)).toBeNull();
  });

  it("total da linha e soma", () => {
    expect(lineTotal(1.5, 1999)).toBe(2999);
    expect(lineTotal(3, 250)).toBe(750);
    expect(sumCents([100, 250, 5])).toBe(355);
    expect(sumCents([])).toBe(0);
  });
});
