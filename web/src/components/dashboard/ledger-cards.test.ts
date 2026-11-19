import { describe, expect, it } from "vitest";
import { ledgerCards, ledgerSummary, sideOf } from "./ledger-cards";

const visual = { field: "conta", detail: "empresa", opening: "si", debit: "d", credit: "c", closing: "sf", journal: { debit: "jd", credit: "jc" } };

describe("razonetes", () => {
  it("closes an account whose balance follows its movement and whose journal matches", () => {
    const [card] = ledgerCards(visual, [{ conta: "1.1 - Caixa", empresa: "A", si: 100, d: 50, c: 30, sf: 120, jd: 50, jc: 30 }]);
    expect(card).toMatchObject({ title: "1.1 - Caixa", detail: "A", opening: 100, closing: 120, balanceDiff: 0, ok: true });
    expect(card.journal).toEqual({ debitDiff: 0, creditDiff: 0 });
  });

  it("flags a balance that does not follow the movement", () => {
    const [card] = ledgerCards(visual, [{ conta: "x", si: 100, d: 50, c: 30, sf: 100, jd: 50, jc: 30 }]);
    expect(card.balanceDiff).toBeCloseTo(-20);
    expect(card.ok).toBe(false);
  });

  it("flags a journal that does not add up to the balancete", () => {
    const [card] = ledgerCards(visual, [{ conta: "x", si: 0, d: 50, c: 30, sf: 20, jd: 45, jc: "30" }]);
    expect(card.journal).toEqual({ debitDiff: -5, creditDiff: 0 });
    expect(card.ok).toBe(false);
  });

  it("takes a cent of rounding as closed, and empty values as zero", () => {
    const [card] = ledgerCards(visual, [{ conta: "x", si: null, d: 10.004, c: "", sf: 10, jd: 10, jc: null }]);
    expect(card.ok).toBe(true);
  });

  it("has no journal check without journal measures", () => {
    const { journal, ...plain } = visual;
    void journal;
    const [card] = ledgerCards(plain, [{ conta: "x", si: 0, d: 1, c: 0, sf: 1 }]);
    expect(card.journal).toBeNull();
    expect(card.detail).toBeNull();
  });

  it("sums up how many accounts close and how much is off", () => {
    const cards = ledgerCards(visual, [
      { conta: "a", si: 0, d: 10, c: 0, sf: 10, jd: 10, jc: 0 },
      { conta: "b", si: 0, d: 10, c: 0, sf: 7, jd: 10, jc: 0 },
      { conta: "c", si: 0, d: 10, c: 0, sf: 10, jd: 12, jc: 0 },
    ]);
    expect(ledgerSummary(cards)).toEqual({ accounts: 3, off: 2, offValue: 5 });
  });

  it("writes a signed balance as debit or credit", () => {
    expect(sideOf(5)).toBe("D");
    expect(sideOf(-5)).toBe("C");
    expect(sideOf(0)).toBe("");
  });
});
