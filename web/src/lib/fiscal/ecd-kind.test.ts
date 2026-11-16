/**
 * ECD: years of monthly files do not fit as "the whole file of every period" (the entries are millions of
 * lines a month). The panels read a light fact with every period; the entries stay for the latest file only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { templateSchema } from "../templates/schema";
import { keepsRecord, spedKindFor } from "./sped-kinds";

const kind = spedKindFor("ecd");
const template = templateSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "fiscal-templates", "ecd.json"), "utf8")));
const factOf = (visualId: string): string | undefined => template.visuals.find((v) => v.id === visualId)?.fact;
const visualsOf = (sectionId: string): readonly string[] => template.analyses.find((a) => a.id === sectionId)?.visuals ?? [];

describe("ECD: tables that hold every period", () => {
  it("keeps the whole file for the latest period only", () => {
    expect(kind?.mainFactPeriods).toBe("latest");
  });

  it("keeps balances and statements of every period, without the entries", () => {
    const panels = kind?.blockFacts.paineis_todos_periodos;
    expect(panels).toBeDefined();
    if (!panels) return;
    for (const record of ["I050", "I051", "I150", "I155", "I350", "I355", "J005", "J100", "J150"]) {
      expect(keepsRecord(panels, record), record).toBe(true);
    }
    for (const record of ["I200", "I250", "0000", "C155", "9900"]) {
      expect(keepsRecord(panels, record), record).toBe(false);
    }
  });

  it("declares the light facts in the template with the main fact's columns", () => {
    for (const name of ["paineis_todos_periodos", "bloco_j_demonstracoes"]) {
      const table = template.tables.find((t) => t.name === name);
      expect(table?.sameAs, name).toBe("registros");
    }
  });

  it("points every panel but the entries at the table with every period", () => {
    for (const section of ["visao_geral", "dre", "balancete", "resultado", "demonstracoes"]) {
      const visuals = visualsOf(section);
      expect(visuals.length, section).toBeGreaterThan(0);
      for (const id of visuals) expect(factOf(id), id).toBe("paineis_todos_periodos");
    }
    for (const id of visualsOf("lancamentos")) expect(factOf(id), id).toBeUndefined();
  });

  it("lists the statements block from its own fact", () => {
    for (const id of visualsOf("bloco_j")) expect(factOf(id), id).toBe("bloco_j_demonstracoes");
  });
});
