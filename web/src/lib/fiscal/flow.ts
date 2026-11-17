/**
 * The path of a fiscal dashboard's data, from beginning to end, as a diagram of four columns:
 *
 *   original files → blocks of the file → final tables → sections of the dashboard
 *
 * Drawn from what already describes the dashboard — the kind of file (which blocks each table keeps) and
 * the template (which table each visual reads, which section shows it) — so it never has to be kept by hand.
 * Pure.
 */
import type { Template } from "../templates/schema";
import { dimensionHow, factHow } from "./lineage";
import type { SpedKind } from "./sped-kinds";

export type FlowColumn = "origem" | "blocos" | "tabelas" | "dashboard";

export const FLOW_COLUMNS: readonly FlowColumn[] = ["origem", "blocos", "tabelas", "dashboard"];

export interface FlowNode {
  id: string;
  column: FlowColumn;
  label: string;
  /** One short line under the label. */
  detail: string;
  /** In words, what happens at this point (shown when the node is chosen). */
  notes: string[];
  /** For a table: its name in the dashboard (the panel adds its lines and size). */
  table?: string;
  /** For a section: the group of the dashboard's summary it is listed under. */
  group?: string;
}

export interface FlowLink {
  from: string;
  to: string;
}

export interface FiscalFlow {
  nodes: FlowNode[];
  links: FlowLink[];
}

const ORIGIN = "origem";
const blockId = (block: string): string => `bloco:${block}`;
const tableId = (table: string): string => `tabela:${table}`;
const sectionId = (analysis: string): string => `secao:${analysis}`;

/** What each block of each file is about. A block missing here is shown by its letter alone. */
const BLOCK_TITLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "efd-icms-ipi": {
    0: "Abertura, identificação e cadastros", B: "ISS (Distrito Federal)", C: "Documentos fiscais de mercadorias", D: "Documentos fiscais de serviços",
    E: "Apuração do ICMS e do IPI", G: "CIAP: crédito do ativo permanente", H: "Inventário físico", K: "Produção e estoque",
    1: "Outras informações", 9: "Controle e encerramento",
  },
  "efd-contribuicoes": {
    0: "Abertura, identificação e cadastros", A: "Documentos fiscais de serviços (ISS)", C: "Documentos fiscais de mercadorias",
    D: "Serviços de transporte e comunicação", F: "Demais documentos e operações", I: "Instituições financeiras e seguradoras",
    M: "Apuração do PIS/Pasep e da Cofins", P: "Contribuição previdenciária sobre a receita bruta", 1: "Complemento da escrituração",
    9: "Controle e encerramento",
  },
  ecd: {
    0: "Abertura, identificação e cadastros", C: "Informações da escrituração anterior", I: "Lançamentos e saldos contábeis",
    J: "Demonstrações contábeis", K: "Conglomerados econômicos", 9: "Controle e encerramento",
  },
};

/** The block each cadastro is read from (the records that bring it). */
const DIMENSION_SOURCE: Readonly<Record<string, { block: string; records: string }>> = {
  estabelecimentos: { block: "0", records: "0000 e 0140" },
  empresas: { block: "0", records: "0000" },
  participantes: { block: "0", records: "0150" },
  itens: { block: "0", records: "0200" },
  plano_contas: { block: "I", records: "I050 e I051" },
};

/** Where a block comes in the file: 0 opens it, the lettered ones follow, 1 and 9 close it. */
const blockRank = (block: string): string => (block === "0" ? "0" : /[A-Z]/.test(block) ? `1${block}` : `2${block}`);

/** The blocks a kind of file has, in the order they come in the file. */
export function blocksOf(kind: SpedKind): string[] {
  return [...new Set(Object.keys(kind.layout).map((record) => record[0]))].sort((a, b) => (blockRank(a) < blockRank(b) ? -1 : 1));
}

type Visual = Template["visuals"][number];

/**
 * The tables a visual reads: its fact, and the cadastros its fields, measures and own conditions mention
 * (`tabela.coluna`). Found in the text of the definition, so a new kind of visual needs nothing here.
 */
export function tablesOfVisual(t: Pick<Template, "tables" | "fields" | "measures">, visual: Visual, mainFact: string): string[] {
  const own = JSON.stringify(visual);
  const named = [...t.fields, ...t.measures].filter((x) => own.includes(`"${x.id}"`)).map((x) => x.sql);
  const text = [own, ...named].join("\n");
  const dimensions = t.tables
    .filter((tb) => tb.kind === "dimension" && new RegExp(`(^|[^a-z0-9_])${tb.name}\\.`, "i").test(text))
    .map((tb) => tb.name);
  return [visual.fact ?? mainFact, ...dimensions];
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

/** The diagram of a fiscal template (`kind` null: documents read whole, such as the XML of a NF-e). */
export function fiscalFlow(template: Template, kind: SpedKind | null, title: string): FiscalFlow {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const facts = template.tables.filter((tb) => tb.kind === "fact");
  const main = facts[0]?.name ?? "";

  nodes.push({
    id: ORIGIN, column: "origem", label: title, detail: "enviados no admin",
    notes: [
      "Os arquivos como a empresa os gerou, guardados sem mudança na pasta do espaço.",
      kind ? "Cada arquivo é lido uma vez e quebrado nos blocos ao lado; só os novos ou trocados são lidos de novo." : "Cada documento é lido inteiro.",
    ],
  });

  // ---- blocks ----
  const blocks = kind ? blocksOf(kind) : ["documento"];
  for (const block of blocks) {
    const records = kind ? Object.keys(kind.layout).filter((r) => r[0] === block).length : 0;
    nodes.push(kind
      ? {
        id: blockId(block), column: "blocos", label: `Bloco ${block}`, detail: BLOCK_TITLES[kind.templateId]?.[block] ?? `registros ${block}xxx`,
        notes: [`${plural(records, "registro", "registros")} no layout (${block}001 a ${block}990).`, "Cada linha do arquivo vira uma linha, com os campos originais na ordem do layout."],
      }
      : { id: blockId(block), column: "blocos", label: "Documento inteiro", detail: "cada XML, do cabeçalho aos itens", notes: ["O documento é lido inteiro; cada item vira uma linha."] });
    links.push({ from: ORIGIN, to: blockId(block) });
  }

  // ---- tables ----
  for (const table of template.tables) {
    const isFact = table.kind === "fact";
    const blockFact = kind?.blockFacts[table.name];
    const from = !kind
      ? blocks
      : !isFact
        ? [DIMENSION_SOURCE[table.name]?.block ?? "0"]
        : blockFact ? blockFact.blocks.filter((b) => blocks.includes(b)) : table.name === main ? blocks : [];
    const source = DIMENSION_SOURCE[table.name];
    const how = !kind ? [] : isFact ? factHow(kind, table.name, table.name === main) : [...(source ? [`Lido dos registros ${source.records}.`] : []), ...dimensionHow(table.name)];
    nodes.push({
      id: tableId(table.name), column: "tabelas", label: table.name, table: table.name,
      detail: !isFact
        ? "cadastro"
        : table.name === main
          ? (kind?.mainFactPeriods === "latest" ? "arquivo inteiro, período mais recente" : "arquivo inteiro")
          : blockFact?.collapse ? `resumo: ${blockFact.collapse.record} somado` : blockFact?.only ? `só ${blockFact.only.length} registros` : "todos os períodos",
      notes: [...(table.description ? [table.description] : []), ...how],
    });
    for (const block of from) links.push({ from: blockId(block), to: tableId(table.name) });
  }

  // ---- sections of the dashboard ----
  const visuals = new Map(template.visuals.map((v) => [v.id, v]));
  const groupOf = new Map(template.summary.flatMap((g) => g.analyses.map((a) => [a, g.title] as const)));
  // The summary's order is the reading order; a section left out of it comes last.
  const order = [...groupOf.keys()];
  const shown = template.analyses.filter((a) => !a.hidden)
    .sort((a, b) => (order.indexOf(a.id) + 1 || order.length + 1) - (order.indexOf(b.id) + 1 || order.length + 1));
  for (const analysis of shown) {
    const own = analysis.visuals.flatMap((id) => visuals.get(id) ?? []);
    const read = [...new Set(own.flatMap((v) => tablesOfVisual(template, v, main)))].filter((name) => template.tables.some((tb) => tb.name === name));
    nodes.push({
      id: sectionId(analysis.id), column: "dashboard", label: analysis.title, detail: plural(own.length, "visual", "visuais"),
      notes: analysis.description ? [analysis.description] : [],
      ...(groupOf.has(analysis.id) ? { group: groupOf.get(analysis.id) } : {}),
    });
    for (const table of read) links.push({ from: tableId(table), to: sectionId(analysis.id) });
  }
  return { nodes, links };
}

export const linkKey = (link: FlowLink): string => `${link.from}>${link.to}`;

export interface FlowPath {
  nodes: Set<string>;
  links: Set<string>;
}

/** Everything a node comes from (back to the original files) and everything it feeds (on to the dashboard). */
export function flowPath(flow: FiscalFlow, id: string): FlowPath {
  const path: FlowPath = { nodes: new Set([id]), links: new Set() };
  const walk = (start: string, here: "to" | "from", there: "to" | "from"): void => {
    const queue = [start];
    const seen = new Set(queue);
    for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
      for (const link of flow.links) {
        if (link[here] !== node) continue;
        path.links.add(linkKey(link));
        path.nodes.add(link[there]);
        if (!seen.has(link[there])) {
          seen.add(link[there]);
          queue.push(link[there]);
        }
      }
    }
  };
  walk(id, "to", "from");
  walk(id, "from", "to");
  return path;
}
