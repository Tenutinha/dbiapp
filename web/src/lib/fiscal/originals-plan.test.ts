import { describe, expect, it } from "vitest";
import { isCorrecting, planOriginals, preferred, type LocalOriginal, type StoredOriginal } from "./originals-plan";

const local = (periodo: string, over: Partial<LocalOriginal> = {}): LocalOriginal => ({
  path: `C:/dados/${periodo}-${over.sizeBytes ?? 100}.txt`, cnpj: "11222333000181", periodo, sizeBytes: 100, modifiedAt: 1000, correcting: false, ...over,
});
const stored = (periodo: string, sizeBytes = 100): StoredOriginal => ({ key: `orgs/acme/fiscal/ecd/11222333000181/${periodo}/ecd.txt`, cnpj: "11222333000181", periodo, sizeBytes });

describe("isCorrecting", () => {
  it("reads the purpose of the file from its 0000 record", () => {
    expect(isCorrecting("efd-icms-ipi", ["0000", "018", "1", "01012024"])).toBe(true);
    expect(isCorrecting("efd-icms-ipi", ["0000", "018", "0", "01012024"])).toBe(false);
    expect(isCorrecting("efd-contribuicoes", ["0000", "006", "1", ""])).toBe(true);
    const ecd = ["0000", "LECD", "01012024", "31012024", "EMPRESA", "11222333000181", "MT", "1", "5105259", "", "", "0", "1"];
    expect(isCorrecting("ecd", [...ecd, "1", "ABC"])).toBe(true);
    expect(isCorrecting("ecd", [...ecd, "0", ""])).toBe(false);
    expect(isCorrecting("ecd", undefined)).toBe(false);
  });
});

describe("planOriginals", () => {
  it("sends the periods the storage does not have and counts the ones it has", () => {
    const june = local("2026-06");
    const july = local("2026-07");
    const plan = planOriginals([june, july], [stored("2026-06")]);
    expect(plan.upload).toEqual([july]);
    expect(plan.inSync).toBe(1);
    expect(plan.conflicts).toEqual([]);
  });

  it("prefers the correcting file, then the newest, and says when the choice was between equals", () => {
    const original = local("2026-07", { sizeBytes: 100, modifiedAt: 3000 });
    const fix = local("2026-07", { sizeBytes: 101, correcting: true, modifiedAt: 2000 });
    expect(preferred([original, fix])).toBe(fix);
    const plain = planOriginals([original, fix], []);
    expect(plain.upload).toEqual([fix]);
    expect(plain.ambiguous).toEqual([]);

    const newerFix = local("2026-07", { sizeBytes: 102, correcting: true, modifiedAt: 5000 });
    const plan = planOriginals([original, fix, newerFix], []);
    expect(plan.upload).toEqual([newerFix]);
    expect(plan.ambiguous).toEqual([{ chosen: newerFix, others: [fix] }]);
  });

  it("never replaces a stored period: another content is a conflict, left alone", () => {
    const fix = local("2026-07", { sizeBytes: 101, correcting: true });
    const plan = planOriginals([fix], [stored("2026-07", 100)]);
    expect(plan.upload).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].stored[0].sizeBytes).toBe(100);
  });

  it("says when the stored version is one the folder has, but not the one that stands for the period", () => {
    const fix = local("2026-07", { sizeBytes: 101, correcting: true });
    const plan = planOriginals([local("2026-07", { sizeBytes: 100 }), fix], [stored("2026-07", 100)]);
    expect(plan.inSync).toBe(0);
    expect(plan.upload).toEqual([]);
    expect(plan.outdated).toEqual([{ stored: stored("2026-07", 100), preferred: fix }]);
    expect(planOriginals([local("2026-07", { sizeBytes: 100 }), fix], [stored("2026-07", 101)]).inSync).toBe(1);
  });

  it("lists what is stored and not in the folder", () => {
    const only = stored("2025-01");
    expect(planOriginals([local("2026-07")], [only, stored("2026-07")]).onlyStored).toEqual([only]);
  });
});
