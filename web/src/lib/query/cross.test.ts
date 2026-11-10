import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { buildFilterOptionsQuery, buildVisualQuery, type QueryVisual } from "./build";
import { clearCross, crossFields, crossKey, hasCross, isPicked, parseCross, toggleCross } from "./cross";

const t = loadTemplate("vendas-executivo");
const files = Object.fromEntries(t.tables.map((tb) => [tb.name, `/data/${tb.name}.parquet`]));
const visual = (id: string) => t.visuals.find((v) => v.id === id)! as QueryVisual;
const KEY = crossKey("receita_regiao", "regiao");

describe("parseCross", () => {
  it("lê x.<visual>.<campo> e ignora visuais ou campos que não existem", () => {
    const cross = parseCross(t, { [KEY]: ["Sul", "Norte", "Sul"], "x.nao_existe.regiao": "Sul", "x.receita_regiao.outro": "x" });
    expect(cross).toEqual([{ visualId: "receita_regiao", fieldId: "regiao", values: ["Sul", "Norte"] }]);
  });

  it("KPIs não selecionam nada", () => {
    expect(crossFields(visual("k_receita"))).toEqual([]);
    expect(parseCross(t, { "x.k_receita.regiao": "Sul" })).toEqual([]);
  });
});

describe("toggleCross", () => {
  const pick = [{ fieldId: "regiao", value: "Sul" }];

  it("clique simples seleciona só o item e limpa a seleção dos outros visuais", () => {
    const before = new URLSearchParams([["f.ano", "2025"], ["x.outro.canal", "Loja"]]);
    const next = toggleCross(before, "receita_regiao", pick, false);
    expect(next.getAll(KEY)).toEqual(["Sul"]);
    expect(next.get("f.ano")).toBe("2025");
    expect(next.has("x.outro.canal")).toBe(false);
  });

  it("clicar de novo no único item selecionado limpa", () => {
    const next = toggleCross(new URLSearchParams([[KEY, "Sul"]]), "receita_regiao", pick, false);
    expect(hasCross(next)).toBe(false);
  });

  it("clique simples em um item de uma seleção múltipla fica só com ele", () => {
    const next = toggleCross(new URLSearchParams([[KEY, "Sul"], [KEY, "Norte"]]), "receita_regiao", pick, false);
    expect(next.getAll(KEY)).toEqual(["Sul"]);
  });

  it("com Ctrl soma e tira itens, mantendo os outros visuais", () => {
    const before = new URLSearchParams([[KEY, "Norte"], ["x.outro.canal", "Loja"]]);
    const added = toggleCross(before, "receita_regiao", pick, true);
    expect(added.getAll(KEY)).toEqual(["Norte", "Sul"]);
    expect(added.get("x.outro.canal")).toBe("Loja");
    expect(toggleCross(added, "receita_regiao", pick, true).getAll(KEY)).toEqual(["Norte"]);
  });

  it("clearCross tira só a seleção cruzada", () => {
    const next = clearCross(new URLSearchParams([["f.ano", "2025"], [KEY, "Sul"]]));
    expect(next.toString()).toBe("f.ano=2025");
  });
});

describe("isPicked", () => {
  it("exige o valor em todos os campos com seleção", () => {
    expect(isPicked({ a: ["1"], b: [] }, { a: "1", b: "x" })).toBe(true);
    expect(isPicked({ a: ["1"], b: ["y"] }, { a: "1", b: "x" })).toBe(false);
    expect(isPicked({ a: [], b: [] }, { a: "1", b: "x" })).toBe(false);
  });
});

describe("filtro cruzado nas consultas", () => {
  const cross = parseCross(t, { [KEY]: "Sul" });

  it("filtra os outros visuais, com o valor como parâmetro", () => {
    const q = buildVisualQuery(t, files, visual("k_receita"), {}, [], cross);
    expect(q.sql).toContain("WHERE COALESCE(CAST((dim_loja.regiao) AS VARCHAR), '(sem cadastro)') IN ($1)");
    expect(q.sql).toContain("AS dim_loja ON");
    expect(q.params).toEqual(["Sul"]);
  });

  it("não filtra o visual em que o item foi selecionado", () => {
    const q = buildVisualQuery(t, files, visual("receita_regiao"), {}, [], cross);
    expect(q.sql).not.toContain("WHERE");
    expect(q.params).toEqual([]);
  });

  it("soma com os filtros da tela e respeita skipFilters", () => {
    const both = buildVisualQuery(t, files, visual("k_receita"), { ano: ["2025"] }, [], cross);
    expect(both.params).toEqual(["2025", "Sul"]);
    expect(both.sql).toMatch(/IN \(\$1\) AND .* IN \(\$2\)/);
    const skipped = buildVisualQuery(t, files, { ...visual("k_receita"), skipFilters: ["regiao"] }, {}, [], cross);
    expect(skipped.params).toEqual([]);
  });

  it("restringe as opções dos filtros, inclusive do próprio campo", () => {
    const q = buildFilterOptionsQuery(t, files, "regiao", { regiao: ["Norte"] }, [], cross);
    expect(q.params).toEqual(["Sul"]);
  });
});
