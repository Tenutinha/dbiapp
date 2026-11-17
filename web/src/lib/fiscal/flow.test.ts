import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { templateSchema, type Template } from "../templates/schema";
import { blocksOf, fiscalFlow, flowPath, tablesOfVisual, type FiscalFlow } from "./flow";
import { spedKindFor } from "./sped-kinds";

const template = (id: string): Template =>
  templateSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "fiscal-templates", `${id}.json`), "utf8")));

const into = (flow: FiscalFlow, id: string): string[] => flow.links.filter((l) => l.to === id).map((l) => l.from);
const labels = (flow: FiscalFlow, ids: Iterable<string>, column: string): string[] => {
  const wanted = new Set(ids);
  return flow.nodes.filter((n) => n.column === column && wanted.has(n.id)).map((n) => n.label);
};

describe("fiscalFlow", () => {
  const icms = template("efd-icms-ipi");
  const kind = spedKindFor("efd-icms-ipi");
  if (!kind) throw new Error("kind");
  const flow = fiscalFlow(icms, kind, kind.title);

  it("draws the four columns from the kind of file and the template", () => {
    expect(blocksOf(kind)).toEqual(["0", "B", "C", "D", "E", "G", "H", "K", "1", "9"]);
    expect(flow.nodes.filter((n) => n.column === "origem").map((n) => n.label)).toEqual(["EFD ICMS/IPI"]);
    expect(flow.nodes.filter((n) => n.column === "blocos").map((n) => n.label)).toEqual(blocksOf(kind).map((b) => `Bloco ${b}`));
    expect(flow.nodes.filter((n) => n.column === "tabelas").map((n) => n.table)).toEqual(icms.tables.map((t) => t.name));
    expect(flow.nodes.filter((n) => n.column === "dashboard")).toHaveLength(icms.analyses.filter((a) => !a.hidden).length);
    // Every link joins two boxes that exist, one column to the next.
    const column = new Map(flow.nodes.map((n) => [n.id, n.column]));
    const next = { origem: "blocos", blocos: "tabelas", tabelas: "dashboard" } as const;
    for (const link of flow.links) expect(column.get(link.to)).toBe(next[column.get(link.from) as keyof typeof next]);
  });

  it("joins each table to the blocks it keeps", () => {
    expect(into(flow, "tabela:registros")).toEqual(blocksOf(kind).map((b) => `bloco:${b}`));
    expect(into(flow, "tabela:bloco_h_inventario")).toEqual(["bloco:H"]);
    expect(into(flow, "tabela:paineis_todos_periodos")).toEqual(["bloco:C", "bloco:D", "bloco:E"]);
    expect(into(flow, "tabela:participantes")).toEqual(["bloco:0"]);
    const panels = flow.nodes.find((n) => n.id === "tabela:paineis_todos_periodos");
    expect(panels?.detail).toBe("resumo: C190 somado");
    expect(panels?.notes.join(" ")).toContain("C190");
    expect(flow.nodes.find((n) => n.id === "tabela:registros")?.detail).toBe("arquivo inteiro, período mais recente");
  });

  it("joins each section to the tables its visuals read", () => {
    expect(into(flow, "secao:visao_geral")).toContain("tabela:paineis_todos_periodos");
    expect(flow.nodes.find((n) => n.id === "secao:visao_geral")).toMatchObject({ label: "Visão geral", group: "Painéis" });
    // No section without a table, and none reading a table the template does not have.
    for (const node of flow.nodes.filter((n) => n.column === "dashboard")) expect(into(flow, node.id).length).toBeGreaterThan(0);
  });

  it("follows a box back to the files and on to the dashboard, and nowhere else", () => {
    const path = flowPath(flow, "bloco:H");
    expect(labels(flow, path.nodes, "origem")).toHaveLength(1);
    expect(labels(flow, path.nodes, "blocos")).toEqual(["Bloco H"]);
    expect(labels(flow, path.nodes, "tabelas")).toEqual(["registros", "bloco_h_inventario"]);
    expect(labels(flow, path.nodes, "dashboard").length).toBeGreaterThan(0);

    const section = flowPath(flow, "secao:visao_geral");
    expect(labels(flow, section.nodes, "dashboard")).toEqual(["Visão geral"]);
    expect(labels(flow, section.nodes, "blocos")).toEqual(expect.arrayContaining(["Bloco C", "Bloco D", "Bloco E"]));
    expect(section.links.has("origem>bloco:C")).toBe(true);
  });

  it("draws the other fiscal templates too", () => {
    for (const id of ["efd-contribuicoes", "ecd"]) {
      const k = spedKindFor(id);
      if (!k) throw new Error(id);
      const f = fiscalFlow(template(id), k, k.title);
      for (const node of f.nodes.filter((n) => n.column === "tabelas")) expect(into(f, node.id).length, `${id} ${node.label}`).toBeGreaterThan(0);
    }
    expect(into(fiscalFlow(template("ecd"), spedKindFor("ecd") as NonNullable<ReturnType<typeof spedKindFor>>, "ECD"), "tabela:plano_contas")).toEqual(["bloco:I"]);
    // A document read whole (NF-e): one box between the files and the tables.
    const nfe = fiscalFlow(template("nfe"), null, "NF-e");
    expect(nfe.nodes.filter((n) => n.column === "blocos").map((n) => n.label)).toEqual(["Documento inteiro"]);
    expect(into(nfe, "tabela:nfe_itens")).toEqual(["bloco:documento"]);
  });
});

describe("tablesOfVisual", () => {
  const t = {
    tables: [{ name: "registros", kind: "fact" }, { name: "itens", kind: "dimension" }, { name: "participantes", kind: "dimension" }],
    fields: [{ id: "item", label: "Item", sql: "concat(itens.cod_item, ' - ', itens.descr_item)" }, { id: "mes", label: "Mês", sql: "strftime(registros.periodo, '%Y-%m')" }],
    measures: [{ id: "valor", label: "Valor", sql: "SUM(registros.c04)", format: "currency" }],
  } as unknown as Pick<Template, "tables" | "fields" | "measures">;
  const visual = (v: object): Template["visuals"][number] => v as Template["visuals"][number];

  it("reads the visual's fact and the cadastros its fields and conditions name", () => {
    expect(tablesOfVisual(t, visual({ id: "a", type: "bar", field: "item", measures: ["valor"] }), "registros")).toEqual(["registros", "itens"]);
    expect(tablesOfVisual(t, visual({ id: "b", type: "bar", field: "mes", measures: ["valor"], fact: "bloco_h" }), "registros")).toEqual(["bloco_h"]);
    expect(tablesOfVisual(t, visual({ id: "c", type: "rows", columns: [{ label: "Nome", sql: "participantes.nome" }] }), "registros")).toEqual(["registros", "participantes"]);
    // "id_itens.x" is not the table "itens".
    expect(tablesOfVisual(t, visual({ id: "d", type: "kpi", measure: "valor", where: "registros.id_itens.x = 1" }), "registros")).toEqual(["registros"]);
  });
});
