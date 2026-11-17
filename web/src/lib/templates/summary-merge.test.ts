import { describe, expect, it } from "vitest";
import { withNewAnalyses } from "./summary-merge";

const FILE = [
  { title: "Painéis", analyses: ["visao_geral", "indicadores", "dre", "balancete"] },
  { title: "Dados originais", analyses: ["bloco_0", "bloco_i"] },
];

describe("withNewAnalyses", () => {
  it("puts an analysis the catalog never had after the one before it in the file", () => {
    const kept = [{ title: "Painéis", analyses: ["visao_geral", "dre"] }, { title: "Dados originais", analyses: ["bloco_0"] }];
    // "balancete" and "bloco_i" were in the catalog and left out on the screen: they stay out.
    const had = new Set(["visao_geral", "dre", "balancete", "bloco_0", "bloco_i"]);
    expect(withNewAnalyses(kept, FILE, had)).toEqual([
      { title: "Painéis", analyses: ["visao_geral", "indicadores", "dre"] },
      { title: "Dados originais", analyses: ["bloco_0"] },
    ]);
  });

  it("puts it first when nothing before it is shown, and opens the group when the screen has none by that name", () => {
    const had = new Set(["visao_geral", "dre", "balancete", "bloco_0", "bloco_i"]);
    expect(withNewAnalyses([{ title: "Painéis", analyses: ["dre"] }], FILE, had)).toEqual([{ title: "Painéis", analyses: ["indicadores", "dre"] }]);
    expect(withNewAnalyses([{ title: "Resumo", analyses: ["dre"] }], FILE, had)).toEqual([
      { title: "Resumo", analyses: ["dre"] },
      { title: "Painéis", analyses: ["indicadores"] },
    ]);
  });

  it("changes nothing when the file brings no new analysis", () => {
    const kept = [{ title: "Painéis", analyses: ["dre", "visao_geral"] }];
    expect(withNewAnalyses(kept, FILE, new Set(FILE.flatMap((g) => g.analyses)))).toBe(kept);
  });
});
