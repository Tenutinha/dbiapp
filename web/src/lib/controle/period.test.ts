import { describe, expect, it } from "vitest";
import {
  monthChoices, monthDays, parseMonths, parsePeriod, periodDays, periodLabel, periodQuery, singleMonth, MAX_MONTHS,
} from "./period";

const NOW = new Date("2026-11-11T15:00:00Z");

describe("parsePeriod", () => {
  it("defaults to the current month", () => {
    expect(parsePeriod({}, NOW)).toEqual({ kind: "months", months: ["2026-11"] });
    expect(parsePeriod({ mes: "lixo" }, NOW)).toEqual({ kind: "months", months: ["2026-11"] });
  });
  it("reads several months, sorted and without repeats", () => {
    expect(parsePeriod({ mes: "2026-11,2026-09,2026-11,2026-13" }, NOW)).toEqual({ kind: "months", months: ["2026-09", "2026-11"] });
  });
  it("reads the last days, only the offered amounts", () => {
    expect(parsePeriod({ dias: "15" }, NOW)).toEqual({ kind: "days", days: 15 });
    expect(parsePeriod({ dias: "16", mes: "2026-10" }, NOW)).toEqual({ kind: "months", months: ["2026-10"] });
  });
  it("keeps at most a year of months (the most recent)", () => {
    const many = Array.from({ length: 20 }, (_, i) => `2025-${String((i % 12) + 1).padStart(2, "0")}`).join(",");
    expect(parseMonths(`${many},2026-01,2026-02`)).toHaveLength(MAX_MONTHS);
    expect(parseMonths(`${many},2026-01,2026-02`).at(-1)).toBe("2026-02");
  });
});

describe("periodDays", () => {
  it("covers whole months, February included", () => {
    expect(monthDays("2026-02")).toHaveLength(28);
    expect(monthDays("2028-02")).toHaveLength(29);
    const days = periodDays({ kind: "months", months: ["2026-01", "2026-03"] }, "2026-11-11");
    expect(days).toHaveLength(62);
    expect(days[0]).toBe("2026-01-01");
    expect(days.at(-1)).toBe("2026-03-31");
  });
  it("ends the last days today, across months", () => {
    const days = periodDays({ kind: "days", days: 15 }, "2026-11-05");
    expect(days).toHaveLength(15);
    expect(days[0]).toBe("2026-10-22");
    expect(days.at(-1)).toBe("2026-11-05");
  });
});

describe("labels and address", () => {
  it("names the period", () => {
    expect(periodLabel({ kind: "months", months: ["2026-11"] })).toBe("novembro de 2026");
    expect(periodLabel({ kind: "months", months: ["2026-10", "2026-11"] })).toBe("out/26, nov/26");
    expect(periodLabel({ kind: "months", months: ["2026-01", "2026-02", "2026-03", "2026-04"] })).toBe("4 competências");
    expect(periodLabel({ kind: "days", days: 45 })).toBe("Últimos 45 dias");
  });
  it("writes the address, leaving the current month implicit", () => {
    expect(periodQuery({ kind: "months", months: ["2026-11"] }, "2026-11")).toBe("");
    expect(periodQuery({ kind: "months", months: ["2026-10", "2026-11"] }, "2026-11")).toBe("mes=2026-10,2026-11");
    expect(periodQuery({ kind: "days", days: 7 }, "2026-11")).toBe("dias=7");
  });
  it("knows when the arrows apply", () => {
    expect(singleMonth({ kind: "months", months: ["2026-10"] })).toBe("2026-10");
    expect(singleMonth({ kind: "months", months: ["2026-10", "2026-11"] })).toBeNull();
    expect(singleMonth({ kind: "days", days: 7 })).toBeNull();
  });
  it("offers the past year and a couple of months ahead, newest first", () => {
    const choices = monthChoices("2026-11-11");
    expect(choices[0]).toBe("2027-01");
    expect(choices).toContain("2026-11");
    expect(choices.at(-1)).toBe("2025-11");
    expect(choices).toHaveLength(15);
  });
});
