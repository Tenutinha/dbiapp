/**
 * Gera os moldes dos três SPEDs (web/fiscal-templates/{efd-icms-ipi,efd-contribuicoes,ecd}.json) a partir
 * dos layouts em src/lib/fiscal/layouts: painéis analíticos no topo e, abaixo, os dados originais — uma
 * seção por bloco, uma listagem por registro, uma coluna por campo do layout.
 *
 * Uso (em web/): node --import tsx scripts/fiscal/gerar-moldes.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { factColumns, fieldColumn, FACT_BASE, SPED_KINDS, type Collapse, type SpedKind } from "../../src/lib/fiscal/sped-kinds";
import { templateSchema } from "../../src/lib/templates/schema";

type Json = Record<string, unknown>;
interface Field { id: string; label: string; sql: string }
interface Measure { id: string; label: string; sql: string; format: "currency" | "currency_exact" | "number" | "integer" | "percent" | "text" }
interface Section { id: string; title: string; description: string; visuals: Json[]; layout?: "grid" | "row"; strip?: string[] }

const F = "registros";
const kindOf = (id: string): SpedKind => SPED_KINDS.find((k) => k.templateId === id)!;

/** Column of a named field of a record, per the layout (fails loudly on a wrong name). */
function col(kind: SpedKind, reg: string, name: string): string {
  const i = kind.layout[reg]?.c.indexOf(name) ?? -1;
  if (i < 0) throw new Error(`${kind.templateId}: ${reg} não tem o campo ${name}`);
  return `${F}.${fieldColumn(i + 1)}`;
}
/** SPED numbers come with a decimal comma. */
const num = (expr: string): string => `TRY_CAST(replace(${expr}, ',', '.') AS DOUBLE)`;
const isReg = (...regs: string[]): string =>
  regs.length === 1 ? `${F}.registro = '${regs[0]}'` : `${F}.registro IN (${regs.map((r) => `'${r}'`).join(", ")})`;
const sumWhen = (cond: string, expr: string): string => `SUM(CASE WHEN ${cond} THEN ${expr} END)`;
const countWhen = (cond: string): string => `COUNT(CASE WHEN ${cond} THEN 1 END)`;
const nz = (expr: string): string => `COALESCE(${expr}, 0)`;
/** Text safe inside a quoted SQL literal of the template (see SAFE_SQL in schema.ts). */
const literal = (s: string): string => s.replace(/[–—]/g, "-").replace(/[^\p{L}\p{N}_ .,()/-]/gu, " ").replace(/\s+/g, " ").trim();

const kpi = (id: string, title: string, measure: string, span: number, where: string): Json => ({ id, type: "kpi", title, measure, span, where });

const BLOCKS: Record<string, Record<string, string>> = {
  "efd-icms-ipi": {
    "0": "Abertura, identificação e referências", B: "Escrituração e apuração do ISS", C: "Documentos fiscais I – mercadorias (ICMS/IPI)",
    D: "Documentos fiscais II – serviços (ICMS)", E: "Apuração do ICMS e do IPI", G: "Controle do crédito de ICMS do ativo permanente (CIAP)",
    H: "Inventário físico", K: "Controle da produção e do estoque", "1": "Outras informações", "9": "Controle e encerramento do arquivo",
  },
  "efd-contribuicoes": {
    "0": "Abertura, identificação e referências", A: "Documentos fiscais – serviços (ISS)", C: "Documentos fiscais I – mercadorias (ICMS/IPI)",
    D: "Documentos fiscais II – serviços (ICMS)", F: "Demais documentos e operações", I: "Operações das instituições financeiras e assemelhadas",
    M: "Apuração da contribuição e crédito de PIS/Pasep e da Cofins", P: "Apuração da contribuição previdenciária sobre a receita bruta",
    "1": "Complemento da escrituração – controle de saldos e operações extemporâneas", "9": "Controle e encerramento do arquivo",
  },
  ecd: {
    "0": "Abertura, identificação e referências", C: "Informações recuperadas da escrituração anterior", I: "Lançamentos contábeis",
    J: "Demonstrações contábeis", K: "Conglomerados econômicos", "9": "Controle e encerramento do arquivo",
  },
};

/**
 * Where the map of files reads from: the closing block (its 9999 line says how many lines the file has) when it
 * has a table of its own with every period; else the table of the panels of every period, by its lines. Every
 * line of the block counts, not the 9999 alone: a file that came without it is still a file on the map.
 */
function fileMap(kind: SpedKind): { fact: string; where?: string; measure: string } {
  if (kind.blockFacts.bloco_9_encerramento) return { fact: "bloco_9_encerramento", measure: "linhas_arquivo" };
  if (kind.blockFacts.paineis_todos_periodos) return { fact: "paineis_todos_periodos", measure: "linhas" };
  throw new Error(`${kind.templateId}: sem tabela de todos os períodos para o mapa de arquivos`);
}

/** "C100 - Nota fiscal …" for every record of the layout, as one CASE (used as a field and a filter). */
function registroNome(kind: SpedKind): string {
  const whens = Object.entries(kind.layout).map(([code, r]) => `WHEN '${code}' THEN '${code} - ${literal(r.d).slice(0, 70)}'`);
  return `CASE ${F}.registro ${whens.join(" ")} ELSE ${F}.registro END`;
}

/**
 * The original data, in one section: the count of lines per record, then one listing per record with one column
 * per field, side by side in a strip (the reader tells at a glance what is the platform's analysis and what is
 * the file as it came). A block that keeps only its own visuals (`leadOnly`) stays a section of its own.
 */
function rawSections(
  kind: SpedKind,
  opts: {
    skipFilters?: (reg: string) => string[] | undefined;
    /** Visuals that open a block's section, before the listings of its records (e.g. its totals by month). */
    lead?: Readonly<Record<string, Json[]>>;
    /** Blocks whose section keeps only those visuals: the listings of the raw records are left out. */
    leadOnly?: ReadonlySet<string>;
    /** Blocks whose section lays its visuals side by side, in a strip that scrolls sideways. */
  },
): Section[] {
  const blocks = BLOCKS[kind.templateId];
  const rootBlocks = new Set(Object.keys(kind.roots).map((r) => r[0]));
  const multiEstab = kind.establishmentRecords.size > 0;
  const sections: Section[] = [];
  // The cover of the original data: the files there are, a company per line and a month per column, read from
  // the lightest table that has every file. A click on a square shows the listings of that file alone.
  const map = fileMap(kind);
  const original: Json[] = [{
    id: "m_arquivos", type: "matrix", title: "Mapa dos arquivos: um quadrado por arquivo (empresa × mês). Clique num quadrado para ver só os registros dele",
    row: "cnpj_arquivo", column: "mes_arquivo", measure: map.measure, span: 12, fact: map.fact, ...(map.where ? { where: map.where } : {}),
    skipFilters: ["bloco", "registro_nome"],
  }, {
    id: "t_registros", type: "table", title: "Linhas por registro", fields: ["bloco", "registro_nome"], measures: ["linhas"], limit: 400, span: 12,
  }];
  // A block that has a fact of its own is listed from it: every period, not only the ones loaded whole.
  // (Only a fact that keeps the block as it came: a summary has no original lines to list.)
  const tableOfBlock: Record<string, string> = Object.fromEntries(
    Object.entries(kind.blockFacts)
      .filter(([, fact]) => !fact.collapse && !fact.only && !fact.skip)
      .flatMap(([table, fact]) => fact.blocks.map((b) => [b, table])),
  );
  const known = Object.keys(kind.layout);
  // File order: block 0 first, the lettered ones, then 1 and 9 (object keys alone would put the digits first).
  const rank = (b: string): number => (b === "0" ? 0 : b === "1" ? 2 : b === "9" ? 3 : 1);
  const ordered = Object.entries(blocks).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  for (const [block, name] of ordered) {
    const visuals: Json[] = known.filter((code) => code[0] === block).map((code) => {
      const rec = kind.layout[code];
      const isChild = rootBlocks.has(block) && !(code in kind.roots) && !/^.(001|010|990)$/.test(code);
      return {
        id: `r_${code.toLowerCase()}`,
        type: "rows",
        title: `${code} · ${rec.d}`,
        span: 12,
        where: isReg(code),
        hideEmpty: true,
        ...(tableOfBlock[block] ? { fact: tableOfBlock[block] } : {}),
        ...(opts.skipFilters?.(code) ? { skipFilters: opts.skipFilters(code) } : {}),
        orderBy: `${F}.arquivo, ${F}.linha`,
        limit: 20,
        expand: { filter: "registro_nome", limit: 1000 },
        columns: [
          { label: "Arquivo", sql: `${F}.arquivo` },
          { label: "Linha", sql: `${F}.linha` },
          ...(multiEstab && block !== "0" && block !== "9" ? [{ label: "Estabelecimento", sql: `${F}.cnpj` }] : []),
          ...(isChild ? [{ label: "Documento", sql: `${F}.doc` }] : []),
          ...rec.c.map((label, i) => ({ label, sql: `${F}.${fieldColumn(i + 1)}` })),
        ],
      };
    });
    if (visuals.length === 0) continue;
    const lead = opts.lead?.[block] ?? [];
    if (opts.leadOnly?.has(block)) {
      // The block is shown by its own visuals alone (its raw listings are left out): a section of its own.
      if (lead.length === 0) continue;
      const description = tableOfBlock[block] ? `Todos os períodos enviados, lidos da tabela ${tableOfBlock[block]}.` : "";
      sections.push({ id: `bloco_${block.toLowerCase()}`, title: `Bloco ${block} · ${name}`, description, visuals: lead, ...(lead.length > 1 ? { layout: "row" as const } : {}) });
      continue;
    }
    original.push(...lead, ...visuals);
  }
  original.push(
    {
      id: "r_outros", type: "rows", title: "Registros fora do layout", span: 12, hideEmpty: true,
      where: `${F}.registro NOT IN (${known.map((r) => `'${r}'`).join(", ")})`,
      orderBy: `${F}.arquivo, ${F}.linha`, limit: 20, expand: { filter: "registro_nome", limit: 1000 },
      columns: [
        { label: "Arquivo", sql: `${F}.arquivo` }, { label: "Linha", sql: `${F}.linha` }, { label: "Registro", sql: `${F}.registro` },
        ...Array.from({ length: kind.width }, (_, i) => ({ label: `Campo ${i + 2}`, sql: `${F}.${fieldColumn(i + 1)}` })),
      ],
    },
  );
  sections.push({
    id: "dados_originais",
    title: "Dados originais",
    description: "Os arquivos como vieram: primeiro quantas linhas cada registro tem, depois um quadro por registro, na ordem dos blocos, com todos os campos do layout. "
      + "Os quadros ficam lado a lado: role para o lado ou use a barra do cabeçalho. Registros que os arquivos não trazem não aparecem. "
      + "O mapa mostra os arquivos que existem; um clique num quadrado deixa só os registros daquele arquivo (no nome da empresa, os dela; no mês, os dele)."
      + (kind.mainFactPeriods === "latest"
        ? ` Só o arquivo mais recente de cada empresa fica guardado inteiro: num arquivo mais antigo aparecem os registros dos blocos guardados para todos os períodos (${Object.keys(tableOfBlock).sort().join(", ")}).`
        : ""),
    visuals: original,
    layout: "row",
  });
  return sections;
}

function factTable(kind: SpedKind): Json {
  const required = new Set<string>(["arquivo", "cnpj", "periodo", "linha", "bloco", "registro"]);
  const types: Record<string, string> = { periodo: "date", linha: "integer", dt_doc: "date" };
  const describe: Record<string, string> = {
    arquivo: "CNPJ do declarante e mês do arquivo", cnpj: "Estabelecimento a que a linha pertence", periodo: "Primeiro dia do período da linha",
    linha: "Número da linha no arquivo", bloco: "Bloco do registro", registro: "Código do registro (REG)",
    doc: "Número do documento ou lançamento a que a linha pertence", dt_doc: "Data desse documento", oper: "IND_OPER do documento (0 entrada, 1 saída)",
    id_part: "Participante: CNPJ do declarante + '-' + COD_PART", id_item: "Item: CNPJ do declarante + '-' + COD_ITEM",
    id_cta: "Conta: CNPJ do declarante + '-' + COD_CTA",
  };
  return {
    name: F,
    kind: "fact",
    description: `Uma linha por linha do arquivo ${kind.title}: os campos originais ficam em c01, c02… na ordem do layout (o REG fica em "registro").`,
    sortBy: "registro, arquivo, linha",
    columns: factColumns(kind).map((name) => ({
      name,
      type: types[name] ?? "text",
      ...(required.has(name) ? {} : { required: false }),
      ...(describe[name] ? { description: describe[name] } : (FACT_BASE as readonly string[]).includes(name) ? {} : { description: `Campo ${Number(name.slice(1)) + 1} do registro` }),
    })),
  };
}

/** Extra facts of the kind: some blocks of the file, with the main fact's columns (see SpedKind.blockFacts). */
function blockFactTables(kind: SpedKind): Json[] {
  return Object.entries(kind.blockFacts).map(([name, fact]) => {
    const blocks = `${fact.blocks.length === 1 ? "do bloco" : "dos blocos"} ${fact.blocks.join(", ")}`;
    const table = { ...factTable(kind), name, sameAs: F };
    if (!fact.collapse) {
      return { ...table, description: `Só as linhas ${blocks} do arquivo ${kind.title}, com as mesmas colunas de "${F}": leve o bastante para guardar todos os períodos.` };
    }
    const by = [fact.collapse.byEstablishment ? "estabelecimento" : null, fact.collapse.byItem ? "item" : null, ...fact.collapse.keys].filter(Boolean).join(", ");
    return {
      ...table,
      description: `Resumo ${blocks} do arquivo ${kind.title}: as linhas do registro ${fact.collapse.record} somadas por arquivo, operação, ${by}, no mesmo layout de "${F}". Para os painéis de todos os períodos.`,
      source: collapseSource(kind, fact.collapse),
    };
  });
}

/**
 * How the ingest sums a record up (see Collapse): the raw file has the fact's columns, one line per line of
 * the SPED file; the lines of the record are grouped, the others stay one by one (their line number keeps them apart).
 */
function collapseSource(kind: SpedKind, c: Collapse): Json {
  const is = `registro = '${c.record}'`;
  const position = (name: string): string => {
    const i = kind.layout[c.record]?.c.indexOf(name) ?? -1;
    if (i < 0) throw new Error(`${kind.templateId}: ${c.record} não tem o campo ${name}`);
    return fieldColumn(i + 1);
  };
  const keys = new Set(c.keys.map(position));
  const sums = new Set(c.sums.map(position));
  /** Kept on the other records, emptied on the summed one. */
  const others = (col: string): string => `any_value(CASE WHEN ${is} THEN NULL ELSE ${col} END)`;
  const derive: Record<string, string> = {
    // The declarant's CNPJ starts the file's name.
    ...(c.byEstablishment ? {} : { cnpj: `CASE WHEN ${is} THEN left(arquivo, 14) ELSE cnpj END` }),
    periodo: "any_value(periodo)",
    linha: `CASE WHEN ${is} THEN 0 ELSE linha END`,
    bloco: "any_value(bloco)",
    doc: others("doc"),
    dt_doc: others("dt_doc"),
  };
  for (const link of Object.keys(kind.links)) {
    if (!(link === "id_item" && c.byItem)) derive[link] = others(link);
  }
  for (let i = 1; i <= kind.width; i += 1) {
    const col = fieldColumn(i);
    if (keys.has(col)) continue;
    derive[col] = sums.has(col)
      ? `CASE WHEN any_value(registro) = '${c.record}' THEN replace(CAST(SUM(TRY_CAST(replace(${col}, ',', '.') AS DECIMAL(28, 5))) AS VARCHAR), '.', ',') ELSE any_value(${col}) END`
      : others(col);
  }
  return {
    description: `As linhas ${kind.title} como vieram do arquivo; as do registro ${c.record} são somadas na entrada.`,
    columns: factTable(kind).columns,
    derive,
    groupBy: ["arquivo", "cnpj", "linha", "registro", "oper", ...(c.byItem ? ["id_item"] : []), ...keys],
  };
}

const DIM_TABLES: Record<string, Json> = {
  estabelecimentos: { name: "estabelecimentos", kind: "dimension", description: "Estabelecimentos (registros 0000 e 0140).", key: "cnpj", columns: [
    { name: "cnpj", type: "text" }, { name: "nome", type: "text" }, { name: "uf", type: "text", required: false }] },
  participantes: { name: "participantes", kind: "dimension", description: "Participantes (registro 0150).", key: "id_part", columns: [
    { name: "id_part", type: "text" }, { name: "nome", type: "text" }, { name: "cnpj_cpf", type: "text", required: false }, { name: "uf", type: "text", required: false }] },
  itens: { name: "itens", kind: "dimension", description: "Itens (registro 0200).", key: "id_item", columns: [
    { name: "id_item", type: "text" }, { name: "cod_item", type: "text" }, { name: "descricao", type: "text" },
    { name: "ncm", type: "text", required: false }, { name: "tipo_item", type: "text", required: false }] },
  empresas: { name: "empresas", kind: "dimension", description: "Empresas declarantes (registro 0000).", key: "cnpj", columns: [
    { name: "cnpj", type: "text" }, { name: "nome", type: "text" }, { name: "uf", type: "text", required: false }] },
  plano_contas: { name: "plano_contas", kind: "dimension", description: "Plano de contas (I050) com a conta referencial (I051) e os grupos de nível 1 a 3.", key: "id_cta", columns: [
    { name: "id_cta", type: "text" }, { name: "cod_cta", type: "text" }, { name: "nome", type: "text" }, { name: "natureza", type: "text" },
    { name: "nivel", type: "integer", required: false }, { name: "grupo_1", type: "text", required: false }, { name: "grupo_2", type: "text", required: false },
    { name: "grupo_3", type: "text", required: false }, { name: "conta_sintetica", type: "text", required: false },
    { name: "cod_cta_ref", type: "text", required: false }] },
};
const DIM_LINK: Record<string, string> = { estabelecimentos: "cnpj", participantes: "id_part", itens: "id_item", empresas: "cnpj", plano_contas: "id_cta" };

interface Parts {
  name: string;
  area: string;
  description: string;
  fields: Field[];
  measures: Measure[];
  filters: string[];
  filterDefaults?: Record<string, string>;
  panels: Section[];
  panelGroup: string;
  skipFilters?: (reg: string) => string[] | undefined;
  /** Visuals that open the original-data section of a block (block code → visuals). */
  lead?: Readonly<Record<string, Json[]>>;
  /** Blocks whose original-data section keeps only its `lead` visuals, without the raw record listings. */
  leadOnly?: ReadonlySet<string>;
}

function build(kind: SpedKind, p: Parts): Json {
  const raw = rawSections(kind, { skipFilters: p.skipFilters, lead: p.lead, leadOnly: p.leadOnly });
  const sections = [...p.panels, ...raw];
  return {
    id: kind.templateId,
    version: 1,
    name: p.name,
    area: p.area,
    origin: "web",
    description: p.description,
    tables: [factTable(kind), ...blockFactTables(kind), ...kind.dimensions.map((d) => DIM_TABLES[d])],
    relationships: kind.dimensions.map((d) => ({ from: { table: F, column: DIM_LINK[d] }, to: { table: d, column: DIM_LINK[d] } })),
    fields: [
      ...p.fields,
      { id: "bloco", label: "Bloco", sql: `${F}.bloco` },
      // The file a line came from, as the map of files shows it: its company and its month ("<cnpj>-aaaa-mm").
      // The company is the file's own (the name minus "-aaaa-mm"): a line may carry the CNPJ of an establishment.
      { id: "cnpj_arquivo", label: "Empresa (CNPJ)", sql: `left(${F}.arquivo, length(${F}.arquivo) - 8)` },
      { id: "mes_arquivo", label: "Mês do arquivo", sql: `right(${F}.arquivo, 7)` },
      { id: "registro_nome", label: "Registro", sql: registroNome(kind) },
    ],
    measures: [
      ...p.measures,
      { id: "linhas", label: "Linhas", sql: "COUNT(*)", format: "integer" },
      // The file's own count of its lines (9999, QTD_LIN).
      { id: "linhas_arquivo", label: "Linhas no arquivo", sql: sumWhen(isReg("9999"), `TRY_CAST(${col(kind, "9999", "QTD_LIN")} AS BIGINT)`), format: "integer" },
    ],
    filters: [...p.filters, "bloco", "registro_nome"],
    filterDefaults: p.filterDefaults ?? {},
    visuals: sections.flatMap((s) => s.visuals),
    analyses: sections.map((s) => ({
      id: s.id, title: s.title, description: s.description, visuals: s.visuals.map((v) => v.id as string), ...(s.layout ? { layout: s.layout } : {}), ...(s.strip ? { strip: s.strip } : {}),
    })),
    summary: [
      // A block shown by its own visuals is an analysis like the panels; the original data is one topic alone.
      { title: p.panelGroup, analyses: [...p.panels, ...raw.filter((s) => s.id !== "dados_originais")].map((s) => s.id) },
      { title: "Dados originais", analyses: ["dados_originais"] },
    ],
    // Read as records: each analysis a page the scroll stops at, in small type.
    paging: "pages",
    density: "compact",
  };
}

// ------------------------------------------------------------------ EFD ICMS/IPI

function efdIcms(): Json {
  const k = kindOf("efd-icms-ipi");
  const AN = ["C190", "C490", "C590", "C850", "D190", "D590"];
  for (const r of AN) {
    const same = ["CST_ICMS", "CFOP", "ALIQ_ICMS", "VL_OPR", "VL_BC_ICMS", "VL_ICMS"].every((n, i) => col(k, r, n) === `${F}.${fieldColumn(i + 1)}`);
    if (!same) throw new Error(`registro analítico ${r} com posições diferentes`);
  }
  const an = isReg(...AN);
  const c = (n: number): string => `${F}.${fieldColumn(n)}`;
  const saida = `${an} AND ${F}.oper = '1'`;
  const entrada = `${an} AND ${F}.oper = '0'`;
  const c100 = isReg("C100");
  const valido = `${c100} AND ${col(k, "C100", "COD_SIT")} NOT IN ('02', '03', '04', '05')`;
  const e110 = isReg("E110");
  const c170 = isReg("C170");
  const h010 = isReg("H010");
  const apur = (name: string): string => sumWhen(e110, num(col(k, "E110", name)));

  const fields: Field[] = [
    { id: "ano", label: "Ano", sql: `CAST(year(${F}.periodo) AS VARCHAR)` },
    { id: "mes", label: "Mês", sql: `strftime(${F}.periodo, '%Y-%m')` },
    { id: "estabelecimento", label: "Estabelecimento", sql: "estabelecimentos.nome" },
    { id: "operacao", label: "Operação", sql: `CASE ${F}.oper WHEN '0' THEN 'Entrada' WHEN '1' THEN 'Saída' END` },
    { id: "cfop", label: "CFOP", sql: c(2) },
    { id: "grupo_cfop", label: "Grupo de CFOP", sql: `CASE left(${c(2)}, 1) WHEN '1' THEN 'Entrada estadual' WHEN '2' THEN 'Entrada interestadual' WHEN '3' THEN 'Entrada do exterior' WHEN '5' THEN 'Saída estadual' WHEN '6' THEN 'Saída interestadual' WHEN '7' THEN 'Saída para o exterior' ELSE 'Outros' END` },
    { id: "cst_icms", label: "CST ICMS", sql: c(1) },
    { id: "aliquota", label: "Alíquota ICMS", sql: `concat(${c(3)}, '%')` },
    { id: "modelo", label: "Modelo do documento", sql: col(k, "C100", "COD_MOD") },
    { id: "situacao", label: "Situação do documento", sql: `CASE ${col(k, "C100", "COD_SIT")} WHEN '00' THEN '00 - Regular' WHEN '01' THEN '01 - Extemporâneo' WHEN '02' THEN '02 - Cancelado' WHEN '03' THEN '03 - Cancelado extemporâneo' WHEN '04' THEN '04 - Denegado' WHEN '05' THEN '05 - Inutilizado' WHEN '06' THEN '06 - Complementar' WHEN '07' THEN '07 - Complementar extemporâneo' WHEN '08' THEN '08 - Regime especial' ELSE ${col(k, "C100", "COD_SIT")} END` },
    { id: "participante", label: "Participante", sql: "participantes.nome" },
    { id: "uf_participante", label: "UF do participante", sql: "participantes.uf" },
    { id: "item", label: "Item", sql: "itens.descricao" },
    { id: "ncm", label: "NCM", sql: "itens.ncm" },
  ];
  const measures: Measure[] = [
    { id: "valor_operacoes", label: "Valor das operações", sql: sumWhen(an, num(c(4))), format: "currency" },
    { id: "valor_saidas", label: "Saídas", sql: sumWhen(saida, num(c(4))), format: "currency" },
    { id: "valor_entradas", label: "Entradas", sql: sumWhen(entrada, num(c(4))), format: "currency" },
    { id: "base_icms", label: "Base de cálculo do ICMS", sql: sumWhen(an, num(c(5))), format: "currency" },
    { id: "icms_debito", label: "ICMS a débito", sql: sumWhen(saida, num(c(6))), format: "currency" },
    { id: "icms_credito", label: "ICMS a crédito", sql: sumWhen(entrada, num(c(6))), format: "currency" },
    { id: "carga_icms_saidas", label: "Carga de ICMS nas saídas", sql: `${sumWhen(saida, num(c(6)))} / NULLIF(${sumWhen(saida, num(c(4)))}, 0)`, format: "percent" },
    { id: "icms_st", label: "ICMS-ST", sql: sumWhen(isReg("C190", "C590", "D590"), num(col(k, "C190", "VL_ICMS_ST"))), format: "currency" },
    { id: "ipi", label: "IPI", sql: sumWhen(isReg("C190"), num(col(k, "C190", "VL_IPI"))), format: "currency" },
    { id: "apur_debitos", label: "Débitos (E110)", sql: apur("VL_TOT_DEBITOS"), format: "currency" },
    { id: "apur_creditos", label: "Créditos (E110)", sql: apur("VL_TOT_CREDITOS"), format: "currency" },
    { id: "apur_credor_anterior", label: "Saldo credor anterior", sql: apur("VL_SLD_CREDOR_ANT"), format: "currency" },
    { id: "apur_icms_recolher", label: "ICMS a recolher", sql: apur("VL_ICMS_RECOLHER"), format: "currency" },
    { id: "apur_credor_transportar", label: "Saldo credor a transportar", sql: apur("VL_SLD_CREDOR_TRANSPORTAR"), format: "currency" },
    { id: "documentos", label: "Notas fiscais", sql: countWhen(c100), format: "integer" },
    { id: "valor_docs_entrada", label: "Notas de entrada", sql: sumWhen(`${valido} AND ${F}.oper = '0'`, num(col(k, "C100", "VL_DOC"))), format: "currency" },
    { id: "valor_docs_saida", label: "Notas de saída", sql: sumWhen(`${valido} AND ${F}.oper = '1'`, num(col(k, "C100", "VL_DOC"))), format: "currency" },
    { id: "valor_documentos", label: "Valor das notas", sql: sumWhen(valido, num(col(k, "C100", "VL_DOC"))), format: "currency" },
    { id: "ctes", label: "Documentos de transporte", sql: countWhen(isReg("D100")), format: "integer" },
    { id: "valor_itens_entrada", label: "Itens de entrada", sql: sumWhen(`${c170} AND ${F}.oper = '0'`, num(col(k, "C170", "VL_ITEM"))), format: "currency" },
    { id: "valor_itens_saida", label: "Itens de saída", sql: sumWhen(`${c170} AND ${F}.oper = '1'`, num(col(k, "C170", "VL_ITEM"))), format: "currency" },
    { id: "valor_itens", label: "Valor dos itens", sql: sumWhen(c170, num(col(k, "C170", "VL_ITEM"))), format: "currency" },
    { id: "quantidade_itens", label: "Quantidade", sql: sumWhen(c170, num(col(k, "C170", "QTD"))), format: "number" },
    { id: "valor_inventario", label: "Valor do inventário", sql: sumWhen(h010, num(col(k, "H010", "VL_ITEM"))), format: "currency" },
    { id: "quantidade_inventario", label: "Quantidade em inventário", sql: sumWhen(h010, num(col(k, "H010", "QTD"))), format: "number" },
    { id: "itens_inventario", label: "Itens em inventário", sql: `COUNT(DISTINCT CASE WHEN ${h010} THEN ${F}.id_item END)`, format: "integer" },
  ];
  const panels: Section[] = [
    {
      id: "visao_geral", title: "Visão geral",
      description: "Operações somadas dos registros analíticos (C190, C490, C590, C850, D190 e D590). O ICMS a recolher e o saldo credor vêm da apuração (E110).",
      visuals: [
        kpi("k_saidas", "Saídas", "valor_saidas", 3, an), kpi("k_entradas", "Entradas", "valor_entradas", 3, an),
        kpi("k_icms_debito", "ICMS a débito", "icms_debito", 3, an), kpi("k_icms_credito", "ICMS a crédito", "icms_credito", 3, an),
        kpi("k_icms_recolher", "ICMS a recolher (E110)", "apur_icms_recolher", 3, e110), kpi("k_credor", "Saldo credor a transportar (E110)", "apur_credor_transportar", 3, e110),
        kpi("k_icms_st", "ICMS-ST", "icms_st", 2, an), kpi("k_ipi", "IPI", "ipi", 2, an), kpi("k_carga", "Carga de ICMS nas saídas", "carga_icms_saidas", 2, an),
        { id: "l_icms_mes", type: "line", title: "ICMS a débito e a crédito por mês", field: "mes", measures: ["icms_debito", "icms_credito"], sort: "field", span: 8, where: an },
        { id: "d_grupo_cfop", type: "donut", title: "Operações por grupo de CFOP", field: "grupo_cfop", measure: "valor_operacoes", span: 4, where: an },
        { id: "b_operacoes_mes", type: "bar", title: "Entradas e saídas por mês", field: "mes", measures: ["valor_entradas", "valor_saidas"], sort: "field", span: 12, where: an },
      ],
    },
    {
      id: "apuracao", title: "Apuração do ICMS", description: "Valores do registro E110 de cada período.",
      visuals: [
        { id: "b_apuracao_mes", type: "bar", title: "Débitos e créditos apurados por mês", field: "mes", measures: ["apur_debitos", "apur_creditos"], sort: "field", span: 7, where: e110 },
        { id: "l_recolher_mes", type: "line", title: "ICMS a recolher e saldo credor por mês", field: "mes", measures: ["apur_icms_recolher", "apur_credor_transportar"], sort: "field", span: 5, where: e110 },
        { id: "t_apuracao", type: "table", title: "Apuração por mês", fields: ["mes", "estabelecimento"], measures: ["apur_debitos", "apur_creditos", "apur_credor_anterior", "apur_icms_recolher", "apur_credor_transportar"], limit: 120, span: 12, where: e110 },
      ],
    },
    {
      id: "cfop_cst", title: "CFOP, CST e alíquotas", description: "",
      visuals: [
        { id: "b_cfop", type: "bar", title: "Valor por CFOP", field: "cfop", measures: ["valor_operacoes"], sort: "measure_desc", horizontal: true, limit: 15, span: 6, where: an },
        { id: "t_cfop", type: "table", title: "CFOP: valor, base e ICMS", fields: ["operacao", "cfop"], measures: ["valor_operacoes", "base_icms", "icms_debito", "icms_credito"], limit: 150, span: 6, where: an },
        { id: "t_cst", type: "table", title: "CST de ICMS", fields: ["operacao", "cst_icms"], measures: ["valor_operacoes", "base_icms", "icms_debito", "icms_credito"], limit: 100, span: 6, where: an },
        { id: "b_aliquota", type: "bar", title: "Base de cálculo por alíquota", field: "aliquota", measures: ["base_icms"], sort: "measure_desc", limit: 20, span: 6, where: an },
      ],
    },
    {
      id: "documentos", title: "Notas fiscais e participantes",
      description: "A partir do registro C100 do período mais recente de cada estabelecimento (as notas uma a uma de todos os períodos pesariam demais). Notas canceladas, denegadas e inutilizadas ficam fora dos valores.",
      visuals: [
        kpi("k_documentos", "Notas fiscais", "documentos", 3, c100), kpi("k_docs_saida", "Notas de saída", "valor_docs_saida", 3, c100),
        kpi("k_docs_entrada", "Notas de entrada", "valor_docs_entrada", 3, c100), kpi("k_ctes", "Documentos de transporte (D100)", "ctes", 3, isReg("D100")),
        { id: "t_participantes", type: "table", title: "Participantes", fields: ["participante", "uf_participante"], measures: ["valor_documentos", "valor_docs_entrada", "valor_docs_saida", "documentos"], limit: 100, span: 8, where: c100 },
        { id: "d_situacao", type: "donut", title: "Notas por situação", field: "situacao", measure: "documentos", span: 4, where: c100 },
        { id: "b_uf_participante", type: "bar", title: "Valor das notas por UF do participante", field: "uf_participante", measures: ["valor_docs_entrada", "valor_docs_saida"], sort: "measure_desc", limit: 28, span: 8, where: c100 },
        { id: "d_modelo", type: "donut", title: "Notas por modelo", field: "modelo", measure: "documentos", span: 4, where: c100 },
      ],
    },
    {
      id: "itens", title: "Itens e inventário",
      description: "Itens das notas (C170) somados por item, CST, CFOP e alíquota, e inventário (H010), de todos os períodos enviados.",
      visuals: [
        { id: "t_itens", type: "table", title: "Itens das notas", fields: ["item", "ncm"], measures: ["valor_itens", "valor_itens_entrada", "valor_itens_saida", "quantidade_itens"], limit: 200, span: 8, where: c170, fact: "bloco_c_resumo_itens" },
        { id: "b_ncm", type: "bar", title: "Valor dos itens por NCM", field: "ncm", measures: ["valor_itens"], sort: "measure_desc", horizontal: true, limit: 15, span: 4, where: c170, fact: "bloco_c_resumo_itens" },
        { ...kpi("k_inventario", "Valor do inventário (H010)", "valor_inventario", 6, h010), hideEmpty: true, fact: "bloco_h_inventario" },
        { ...kpi("k_itens_inventario", "Itens em inventário", "itens_inventario", 6, h010), hideEmpty: true, fact: "bloco_h_inventario" },
        { id: "t_inventario", type: "table", title: "Inventário por item", fields: ["item", "ncm"], measures: ["valor_inventario", "quantidade_inventario"], limit: 200, span: 12, where: h010, hideEmpty: true, fact: "bloco_h_inventario" },
      ],
    },
  ];
  // The general panels read every period from the table made for them (the main fact holds one file whole).
  const allPeriods = new Set(["visao_geral", "apuracao", "cfop_cst"]);
  const panelsAllPeriods = panels.map((s) => (allPeriods.has(s.id)
    ? { ...s, visuals: s.visuals.map((v) => (v.fact ? v : { ...v, fact: "paineis_todos_periodos" })) }
    : s));
  return build(k, {
    name: "EFD ICMS/IPI", area: "Fiscal",
    description: "Escrituração fiscal de ICMS e IPI completa: operações, apuração, notas, itens e inventário em painéis, e todos os registros do arquivo com todos os campos para consulta.",
    fields, measures, filters: ["ano", "mes", "estabelecimento", "operacao"], panels: panelsAllPeriods, panelGroup: "Painéis",
  });
}

// ------------------------------------------------------------------ EFD Contribuições

/** What each CST of PIS and COFINS means (Tabela 4.3.3 / 4.3.4 of the EFD Contribuições). */
const CST_PIS_COFINS: Readonly<Record<string, string>> = {
  "01": "Tributável, alíquota básica", "02": "Tributável, alíquota diferenciada", "03": "Tributável, alíquota por unidade",
  "04": "Monofásica, revenda a alíquota zero", "05": "Tributável por substituição tributária", "06": "Alíquota zero",
  "07": "Isenta", "08": "Sem incidência", "09": "Com suspensão", "49": "Outras operações de saída",
  "50": "Crédito, receita tributada no mercado interno", "51": "Crédito, receita não tributada no mercado interno",
  "52": "Crédito, receita de exportação", "53": "Crédito, receitas tributadas e não tributadas no mercado interno",
  "54": "Crédito, receitas tributadas no mercado interno e de exportação", "55": "Crédito, receitas não tributadas no mercado interno e de exportação",
  "56": "Crédito, receitas tributadas, não tributadas e de exportação", "60": "Crédito presumido, receita tributada no mercado interno",
  "61": "Crédito presumido, receita não tributada no mercado interno", "62": "Crédito presumido, receita de exportação",
  "63": "Crédito presumido, receitas tributadas e não tributadas no mercado interno", "64": "Crédito presumido, receitas tributadas no mercado interno e de exportação",
  "65": "Crédito presumido, receitas não tributadas no mercado interno e de exportação", "66": "Crédito presumido, receitas tributadas, não tributadas e de exportação",
  "67": "Crédito presumido, outras operações", "70": "Aquisição sem direito a crédito", "71": "Aquisição com isenção", "72": "Aquisição com suspensão",
  "73": "Aquisição a alíquota zero", "74": "Aquisição sem incidência", "75": "Aquisição por substituição tributária",
  "98": "Outras operações de entrada", "99": "Outras operações",
};
/** "01 - Tributável, alíquota básica" from the code in `expr` (the code alone when it is not in the table). */
const cstDescribed = (expr: string): string =>
  `CASE ${expr} ${Object.entries(CST_PIS_COFINS).map(([code, text]) => `WHEN '${code}' THEN '${code} - ${text}'`).join(" ")} ELSE ${expr} END`;
/** A rate as text, whatever way the file wrote it ("1,65", "1,6500"): "1,65%". */
const rateText = (expr: string): string => `concat(replace(printf('%.2f', ${num(expr)}), '.', ','), '%')`;

function efdContrib(): Json {
  const k = kindOf("efd-contribuicoes");
  const detail = Object.entries(k.layout).filter(([code]) => "ACDF".includes(code[0]));
  const having = (...names: string[]): string[] => detail.filter(([, r]) => names.every((n) => r.c.includes(n))).map(([code]) => code);
  const pisRegs = having("CST_PIS", "VL_PIS");
  const cofRegs = having("CST_COFINS", "VL_COFINS");
  /** One expression that reads `name` from whichever of the records the row is. */
  const pick = (regs: string[], name: (code: string) => string | null): string => {
    const whens = regs.map((code) => [code, name(code)] as const).filter((x): x is readonly [string, string] => x[1] !== null);
    return `CASE ${F}.registro ${whens.map(([code, n]) => `WHEN '${code}' THEN ${col(k, code, n)}`).join(" ")} END`;
  };
  const firstOf = (code: string, names: string[]): string | null => names.find((n) => k.layout[code].c.includes(n)) ?? null;
  const VALUE = ["VL_ITEM", "VL_OPER", "VL_OPR", "VL_TOT_ITEM", "VL_REC", "VL_DOC"];
  const cstPis = pick(pisRegs, () => "CST_PIS");
  const cstCof = pick(cofRegs, () => "CST_COFINS");
  const vlPis = num(pick(pisRegs, () => "VL_PIS"));
  const vlCof = num(pick(cofRegs, () => "VL_COFINS"));
  const bcPis = num(pick(pisRegs, (c) => firstOf(c, ["VL_BC_PIS"])));
  const vlItem = num(pick(pisRegs, (c) => firstOf(c, VALUE)));
  const natCred = pick([...new Set([...pisRegs, ...cofRegs])], (c) => firstOf(c, ["NAT_BC_CRED"]));
  const cfop = pick(pisRegs, (c) => firstOf(c, ["CFOP"]));
  const all = [...new Set([...pisRegs, ...cofRegs])];
  const det = isReg(...all);
  const deb = `${cstPis} < '50'`;
  const cred = `${cstPis} BETWEEN '50' AND '66'`;
  const debC = `${cstCof} < '50'`;
  const credC = `${cstCof} BETWEEN '50' AND '66'`;
  // Bloco A (serviços): a nota (A100) e seus itens (A170). Notas canceladas ficam fora dos valores.
  const a100 = (name: string): string => col(k, "A100", name);
  const a170 = (name: string): string => col(k, "A170", name);
  const isA100 = isReg("A100");
  const isA170 = isReg("A170");
  const notaValida = `${isA100} AND ${a100("COD_SIT")} <> '02'`;
  const nota = (name: string, extra = ""): string => sumWhen(`${notaValida}${extra}`, num(a100(name)));
  const itemServico = (name: string): string => sumWhen(isA170, num(a170(name)));
  /** How far an item's tax is from its base × rate, in absolute value. */
  const offBy = (base: string, rate: string, tax: string): string =>
    `abs(${nz(num(a170(base)))} * ${nz(num(a170(rate)))} / 100 - ${nz(num(a170(tax)))})`;
  const pisOff = offBy("VL_BC_PIS", "ALIQ_PIS", "VL_PIS");
  const cofOff = offBy("VL_BC_COFINS", "ALIQ_COFINS", "VL_COFINS");
  /** A code that may come empty: one "Não informado" for both the empty and the missing. */
  const informed = (expr: string): string => `COALESCE(NULLIF(trim(${expr}), ''), 'Não informado')`;
  const m200 = isReg("M200");
  const m600 = isReg("M600");
  const pisDeb = sumWhen(deb, vlPis);
  const pisCred = sumWhen(cred, vlPis);
  const cofDeb = sumWhen(debC, vlCof);
  const cofCred = sumWhen(credC, vlCof);

  const fields: Field[] = [
    { id: "ano", label: "Ano", sql: `CAST(year(${F}.periodo) AS VARCHAR)` },
    { id: "mes", label: "Mês", sql: `strftime(${F}.periodo, '%Y-%m')` },
    { id: "estabelecimento", label: "Estabelecimento", sql: `concat(estabelecimentos.nome, ' - ', ${F}.cnpj)` },
    { id: "uf_estabelecimento", label: "UF do estabelecimento", sql: "estabelecimentos.uf" },
    { id: "operacao", label: "Operação", sql: `CASE WHEN ${deb} THEN 'Receita (débito)' WHEN ${cred} THEN 'Aquisição com crédito' WHEN ${cstPis} > '66' THEN 'Aquisição sem crédito' END` },
    { id: "bloco_origem", label: "Origem", sql: `CASE ${F}.bloco WHEN 'A' THEN 'A - Serviços' WHEN 'C' THEN 'C - Mercadorias' WHEN 'D' THEN 'D - Transporte e comunicação' WHEN 'F' THEN 'F - Demais operações' ELSE ${F}.bloco END` },
    { id: "cst_pis", label: "CST PIS", sql: cstPis },
    { id: "cst_cofins", label: "CST COFINS", sql: cstCof },
    { id: "tributacao_receita", label: "Tributação da receita", sql: `CASE WHEN ${cstPis} IN ('01', '02', '03', '05') THEN 'Tributada' WHEN ${cstPis} = '04' THEN 'Monofásica (alíquota zero na revenda)' WHEN ${cstPis} = '06' THEN 'Alíquota zero' WHEN ${cstPis} = '07' THEN 'Isenta' WHEN ${cstPis} = '08' THEN 'Sem incidência' WHEN ${cstPis} = '09' THEN 'Com suspensão' WHEN ${deb} THEN 'Outras saídas' END` },
    { id: "nat_bc_cred", label: "Natureza do crédito", sql: natCred },
    { id: "cfop", label: "CFOP", sql: cfop },
    { id: "item", label: "Item", sql: "itens.descricao" },
    { id: "ncm", label: "NCM", sql: "itens.ncm" },
    { id: "participante", label: "Participante", sql: "participantes.nome" },
    { id: "uf_participante", label: "UF do participante", sql: "participantes.uf" },
    { id: "nota_servico", label: "Nota de serviço", sql: `${F}.doc` },
    { id: "servico_operacao", label: "Operação do serviço", sql: `CASE ${F}.oper WHEN '0' THEN 'Serviço contratado' WHEN '1' THEN 'Serviço prestado' END` },
    { id: "servico_situacao", label: "Situação da nota de serviço", sql: `CASE ${a100("COD_SIT")} WHEN '00' THEN '00 - Regular' WHEN '02' THEN '02 - Cancelada' ELSE ${a100("COD_SIT")} END` },
    { id: "servico_aliquotas", label: "Alíquotas de PIS e COFINS", sql: `concat(${rateText(a170("ALIQ_PIS"))}, ' e ', ${rateText(a170("ALIQ_COFINS"))})` },
    { id: "cst_pis_desc", label: "CST PIS", sql: cstDescribed(cstPis) },
    { id: "cst_cofins_desc", label: "CST COFINS", sql: cstDescribed(cstCof) },
    { id: "servico_pagamento", label: "Forma de pagamento", sql: `CASE ${a100("IND_PGTO")} WHEN '0' THEN 'À vista' WHEN '1' THEN 'A prazo' WHEN '2' THEN 'Outras' WHEN '9' THEN 'Sem pagamento' ELSE ${a100("IND_PGTO")} END` },
    { id: "servico_emitente", label: "Emitente da nota", sql: `CASE ${a100("IND_EMIT")} WHEN '0' THEN 'Emissão própria' WHEN '1' THEN 'Emitida por terceiros' ELSE ${a100("IND_EMIT")} END` },
    { id: "servico_conta", label: "Conta contábil (A170)", sql: informed(a170("COD_CTA")) },
    { id: "servico_centro_custo", label: "Centro de custo (A170)", sql: informed(a170("COD_CCUS")) },
    { id: "servico_origem_credito", label: "Origem do crédito", sql: `CASE ${a170("IND_ORIG_CRED")} WHEN '0' THEN 'Mercado interno' WHEN '1' THEN 'Importação' ELSE ${a170("IND_ORIG_CRED")} END` },
  ];
  const measures: Measure[] = [
    { id: "receita", label: "Receita", sql: sumWhen(deb, vlItem), format: "currency" },
    { id: "receita_tributada", label: "Receita tributada", sql: sumWhen(`${cstPis} IN ('01', '02', '03', '05')`, vlItem), format: "currency" },
    { id: "receita_nao_tributada", label: "Receita não tributada", sql: sumWhen(`${cstPis} IN ('04', '06', '07', '08', '09')`, vlItem), format: "currency" },
    { id: "aquisicoes_com_credito", label: "Aquisições com crédito", sql: sumWhen(cred, vlItem), format: "currency" },
    { id: "aquisicoes_sem_credito", label: "Aquisições sem crédito", sql: sumWhen(`${cstPis} > '66'`, vlItem), format: "currency" },
    { id: "base_credito", label: "Base dos créditos", sql: sumWhen(cred, bcPis), format: "currency" },
    { id: "pis_debito", label: "PIS a débito", sql: pisDeb, format: "currency" },
    { id: "pis_credito", label: "PIS a crédito", sql: pisCred, format: "currency" },
    { id: "cofins_debito", label: "COFINS a débito", sql: cofDeb, format: "currency" },
    { id: "cofins_credito", label: "COFINS a crédito", sql: cofCred, format: "currency" },
    { id: "saldo_documentos", label: "PIS + COFINS (débito − crédito)", sql: `${nz(pisDeb)} + ${nz(cofDeb)} - ${nz(pisCred)} - ${nz(cofCred)}`, format: "currency" },
    { id: "carga_receita", label: "Carga de PIS + COFINS sobre a receita", sql: `(${nz(pisDeb)} + ${nz(cofDeb)}) / NULLIF(${sumWhen(deb, vlItem)}, 0)`, format: "percent" },
    { id: "pis_recolher", label: "PIS a recolher (M200)", sql: sumWhen(m200, num(col(k, "M200", "VL_TOT_CONT_REC"))), format: "currency" },
    { id: "pis_apurado", label: "PIS apurado não cumulativo (M200)", sql: sumWhen(m200, num(col(k, "M200", "VL_TOT_CONT_NC_PER"))), format: "currency" },
    { id: "pis_credito_descontado", label: "Crédito de PIS descontado (M200)", sql: sumWhen(m200, num(col(k, "M200", "VL_TOT_CRED_DESC"))), format: "currency" },
    { id: "cofins_recolher", label: "COFINS a recolher (M600)", sql: sumWhen(m600, num(col(k, "M600", "VL_TOT_CONT_REC"))), format: "currency" },
    { id: "cofins_apurado", label: "COFINS apurada não cumulativa (M600)", sql: sumWhen(m600, num(col(k, "M600", "VL_TOT_CONT_NC_PER"))), format: "currency" },
    { id: "cofins_credito_descontado", label: "Crédito de COFINS descontado (M600)", sql: sumWhen(m600, num(col(k, "M600", "VL_TOT_CRED_DESC"))), format: "currency" },
    { id: "documentos", label: "Notas fiscais (C100)", sql: countWhen(isReg("C100")), format: "integer" },
    { id: "serv_valor", label: "Valor dos serviços", sql: nota("VL_DOC"), format: "currency" },
    { id: "serv_prestados", label: "Serviços prestados", sql: nota("VL_DOC", ` AND ${F}.oper = '1'`), format: "currency" },
    { id: "serv_contratados", label: "Serviços contratados", sql: nota("VL_DOC", ` AND ${F}.oper = '0'`), format: "currency" },
    { id: "serv_desconto", label: "Descontos", sql: nota("VL_DESC"), format: "currency" },
    { id: "serv_base_pis", label: "Base de cálculo do PIS", sql: nota("VL_BC_PIS"), format: "currency" },
    { id: "serv_pis", label: "PIS", sql: nota("VL_PIS"), format: "currency" },
    { id: "serv_cofins", label: "COFINS", sql: nota("VL_COFINS"), format: "currency" },
    { id: "serv_pis_cofins", label: "PIS + COFINS", sql: `${nz(nota("VL_PIS"))} + ${nz(nota("VL_COFINS"))}`, format: "currency" },
    { id: "serv_pis_retido", label: "PIS retido na fonte", sql: nota("VL_PIS_RET"), format: "currency" },
    { id: "serv_cofins_retido", label: "COFINS retida na fonte", sql: nota("VL_COFINS_RET"), format: "currency" },
    { id: "serv_retencoes", label: "PIS + COFINS retidos", sql: `${nz(nota("VL_PIS_RET"))} + ${nz(nota("VL_COFINS_RET"))}`, format: "currency" },
    { id: "serv_iss", label: "ISS", sql: nota("VL_ISS"), format: "currency" },
    { id: "serv_carga", label: "Carga de PIS + COFINS sobre os serviços", sql: `(${nz(nota("VL_PIS"))} + ${nz(nota("VL_COFINS"))}) / NULLIF(${nota("VL_DOC")}, 0)`, format: "percent" },
    { id: "serv_notas", label: "Notas de serviço", sql: countWhen(notaValida), format: "integer" },
    { id: "serv_canceladas", label: "Notas canceladas", sql: countWhen(`${isA100} AND ${a100("COD_SIT")} = '02'`), format: "integer" },
    { id: "serv_ticket", label: "Valor médio por nota", sql: `${nota("VL_DOC")} / NULLIF(${countWhen(notaValida)}, 0)`, format: "currency" },
    { id: "serv_itens_valor", label: "Valor dos itens (A170)", sql: itemServico("VL_ITEM"), format: "currency" },
    { id: "serv_itens_liquido", label: "Itens menos descontos (A170)", sql: `${nz(itemServico("VL_ITEM"))} - ${nz(itemServico("VL_DESC"))}`, format: "currency" },
    { id: "serv_itens_base", label: "Base de cálculo dos itens", sql: itemServico("VL_BC_PIS"), format: "currency" },
    { id: "serv_itens_pis", label: "PIS dos itens", sql: itemServico("VL_PIS"), format: "currency" },
    { id: "serv_itens_cofins", label: "COFINS dos itens", sql: itemServico("VL_COFINS"), format: "currency" },
    { id: "serv_itens_qtd", label: "Itens", sql: countWhen(isA170), format: "integer" },
    { id: "serv_itens_tributado", label: "Tributado (CST 01 a 05)", sql: sumWhen(`${isA170} AND ${a170("CST_COFINS")} IN ('01', '02', '03', '05')`, num(a170("VL_ITEM"))), format: "currency" },
    { id: "serv_itens_nao_tributado", label: "Não tributado e outras saídas", sql: sumWhen(`${isA170} AND ${a170("CST_COFINS")} IN ('04', '06', '07', '08', '09', '49')`, num(a170("VL_ITEM"))), format: "currency" },
    { id: "serv_itens_credito", label: "Contratado com crédito (CST 50 a 66)", sql: sumWhen(`${isA170} AND ${a170("CST_COFINS")} BETWEEN '50' AND '66'`, num(a170("VL_ITEM"))), format: "currency" },
    { id: "serv_itens_base_cofins", label: "Base da COFINS dos itens", sql: itemServico("VL_BC_COFINS"), format: "currency" },
    { id: "serv_itens_aliq_pis", label: "Alíquota efetiva do PIS", sql: `${itemServico("VL_PIS")} / NULLIF(${itemServico("VL_BC_PIS")}, 0)`, format: "percent" },
    { id: "serv_itens_aliq_cofins", label: "Alíquota efetiva da COFINS", sql: `${itemServico("VL_COFINS")} / NULLIF(${itemServico("VL_BC_COFINS")}, 0)`, format: "percent" },
    { id: "serv_itens_carga", label: "PIS + COFINS sobre o valor", sql: `(${nz(itemServico("VL_PIS"))} + ${nz(itemServico("VL_COFINS"))}) / NULLIF(${itemServico("VL_ITEM")}, 0)`, format: "percent" },
    // Each item worked out again (base × alíquota): what the file says beyond that, item by item, in absolute value.
    { id: "serv_pis_calculado", label: "PIS calculado (base × alíquota)", sql: `ROUND(${sumWhen(isA170, `${num(a170("VL_BC_PIS"))} * ${num(a170("ALIQ_PIS"))} / 100`)}, 2)`, format: "currency" },
    { id: "serv_cofins_calculada", label: "COFINS calculada (base × alíquota)", sql: `ROUND(${sumWhen(isA170, `${num(a170("VL_BC_COFINS"))} * ${num(a170("ALIQ_COFINS"))} / 100`)}, 2)`, format: "currency" },
    // Rounding to the cent leaves up to half a cent per item: only what goes beyond a cent is a difference.
    { id: "serv_dif_calculo", label: "Diferença de cálculo (PIS + COFINS)", sql: `ROUND(COALESCE(${sumWhen(`${isA170} AND ${pisOff} > 0.01`, pisOff)}, 0) + COALESCE(${sumWhen(`${isA170} AND ${cofOff} > 0.01`, cofOff)}, 0), 2) + 0`, format: "currency" },
    { id: "serv_itens_dif_calculo", label: "Itens com diferença de cálculo", sql: countWhen(`${isA170} AND (${pisOff} > 0.01 OR ${cofOff} > 0.01)`), format: "integer" },
    { id: "serv_diferenca", label: "Diferença entre nota e itens", sql: `abs(${nz(nota("VL_DOC"))} - (${nz(itemServico("VL_ITEM"))} - ${nz(itemServico("VL_DESC"))}))`, format: "currency" },
  ];
  // Bloco M: only fields whose position is the same in every layout version (M210/M610 changed after the third field).
  const mReg = (pis: string, cofins: string, name: string): string =>
    `CASE ${F}.registro WHEN '${pis}' THEN ${col(k, pis, name)} WHEN '${cofins}' THEN ${col(k, cofins, name)} END`;
  const mSum = (reg: string, name: string): string => sumWhen(isReg(reg), num(col(k, reg, name)));
  fields.push(
    { id: "m_cod_cont", label: "Código da contribuição", sql: mReg("M210", "M610", "COD_CONT") },
    { id: "m_cod_cred", label: "Tipo de crédito", sql: mReg("M100", "M500", "COD_CRED") },
  );
  measures.push(
    { id: "m_receita_bruta_pis", label: "Receita bruta (M210)", sql: mSum("M210", "VL_REC_BRT"), format: "currency" },
    { id: "m_receita_bruta_cofins", label: "Receita bruta (M610)", sql: mSum("M610", "VL_REC_BRT"), format: "currency" },
    { id: "m_credito_pis", label: "Crédito de PIS do período (M100)", sql: mSum("M100", "VL_CRED"), format: "currency" },
    { id: "m_credito_cofins", label: "Crédito de COFINS do período (M500)", sql: mSum("M500", "VL_CRED"), format: "currency" },
    { id: "m_credito_periodo", label: "Créditos apurados no período", sql: `${nz(mSum("M100", "VL_CRED"))} + ${nz(mSum("M500", "VL_CRED"))}`, format: "currency" },
    { id: "m_apurado", label: "PIS + COFINS apurados", sql: `${nz(mSum("M200", "VL_TOT_CONT_NC_PER"))} + ${nz(mSum("M600", "VL_TOT_CONT_NC_PER"))}`, format: "currency" },
    { id: "m_credito_descontado", label: "Crédito descontado (PIS + COFINS)", sql: `${nz(mSum("M200", "VL_TOT_CRED_DESC"))} + ${nz(mSum("M600", "VL_TOT_CRED_DESC"))}`, format: "currency" },
  );
  /** Receipts, purchases and credits of one block (D, F), item by item, for every period: the block's own fact. */
  const blockPanel = (block: string, table: string, id: string, title: string, description: string): Section => {
    const p = block.toLowerCase();
    const inBlock = `${det} AND ${F}.bloco = '${block}'`;
    const values = ["receita", "aquisicoes_com_credito", "aquisicoes_sem_credito", "pis_debito", "cofins_debito", "pis_credito", "cofins_credito"];
    return {
      id, title, description,
      visuals: [
        kpi(`k_${p}_receita`, "Receita", "receita", 3, inBlock), kpi(`k_${p}_aquisicoes`, "Aquisições com crédito", "aquisicoes_com_credito", 3, inBlock),
        kpi(`k_${p}_pis_credito`, "PIS a crédito", "pis_credito", 3, inBlock), kpi(`k_${p}_cofins_credito`, "COFINS a crédito", "cofins_credito", 3, inBlock),
        { id: `b_${p}_mes`, type: "bar", title: "Receita e aquisições com crédito por mês", field: "mes", measures: ["receita", "aquisicoes_com_credito"], sort: "field", limit: 240, span: 12, where: inBlock },
        { id: `l_${p}_creditos_mes`, type: "line", title: "Créditos de PIS e COFINS por mês", field: "mes", measures: ["pis_credito", "cofins_credito"], sort: "field", limit: 240, span: 12, where: inBlock },
        { id: `t_${p}_ano`, type: "table", title: "Por ano e operação", fields: ["ano", "operacao"], measures: values, orderBy: "aquisicoes_com_credito", limit: 60, span: 12, where: inBlock },
        { id: `t_${p}_registro`, type: "table", title: "Por registro, CST e natureza do crédito", fields: ["registro_nome", "cst_pis", "nat_bc_cred"], measures: values, orderBy: "aquisicoes_com_credito", limit: 100, span: 12, where: inBlock },
        { id: `t_${p}_participantes`, type: "table", title: "Participantes", fields: ["participante", "uf_participante", "operacao"], measures: values, orderBy: "aquisicoes_com_credito", limit: 200, span: 12, where: inBlock },
      ].map((v) => ({ ...v, fact: table })),
    };
  };
  /** Bloco C for every period, from its two summaries: by establishment (CFOP, CST) and by item. */
  const inC = `${det} AND ${F}.bloco = 'C'`;
  const debCred = ["receita", "aquisicoes_com_credito", "pis_debito", "cofins_debito", "pis_credito", "cofins_credito"];
  const mercadorias: Section = {
    id: "mercadorias_bloco_c", title: "Mercadorias (bloco C)",
    description: "Itens das notas de mercadorias (C170) e energia (C501 e C505) de todos os períodos enviados, lidos de dois resumos do bloco C: um por estabelecimento, CFOP, CST e alíquota, e outro por item. Os valores são os mesmos dos itens somados; as notas e os participantes não entram no resumo.",
    visuals: [
      ...[
        kpi("k_c_receita", "Receita", "receita", 3, inC), kpi("k_c_receita_tributada", "Receita tributada", "receita_tributada", 3, inC),
        kpi("k_c_receita_nao_tributada", "Receita não tributada", "receita_nao_tributada", 3, inC), kpi("k_c_aquisicoes", "Aquisições com crédito", "aquisicoes_com_credito", 3, inC),
        kpi("k_c_pis_debito", "PIS a débito", "pis_debito", 3, inC), kpi("k_c_pis_credito", "PIS a crédito", "pis_credito", 3, inC),
        kpi("k_c_cofins_debito", "COFINS a débito", "cofins_debito", 3, inC), kpi("k_c_cofins_credito", "COFINS a crédito", "cofins_credito", 3, inC),
        { id: "b_c_mes", type: "bar", title: "Receita e aquisições com crédito por mês", field: "mes", measures: ["receita", "aquisicoes_com_credito"], sort: "field", limit: 240, span: 12, where: inC },
        { id: "l_c_tributos_mes", type: "line", title: "Débitos e créditos de PIS e COFINS por mês", field: "mes", measures: ["pis_debito", "cofins_debito", "pis_credito", "cofins_credito"], sort: "field", limit: 240, span: 8, where: inC },
        { id: "d_c_tributacao", type: "donut", title: "Receita por tributação", field: "tributacao_receita", measure: "receita", span: 4, where: `${inC} AND ${deb}` },
        { id: "t_c_ano", type: "table", title: "Por ano", fields: ["ano"], measures: [...debCred, "carga_receita"], limit: 30, span: 12, where: inC },
        { id: "t_c_cfop", type: "table", title: "CFOP", fields: ["operacao", "cfop"], measures: debCred, limit: 150, span: 12, where: inC },
        { id: "t_c_cst", type: "table", title: "CST de PIS e COFINS", fields: ["cst_pis", "cst_cofins"], measures: debCred, limit: 100, span: 12, where: inC },
        { id: "b_c_uf", type: "bar", title: "Receita por UF do estabelecimento", field: "uf_estabelecimento", measures: ["receita", "aquisicoes_com_credito"], sort: "measure_desc", limit: 28, span: 12, where: inC },
        { id: "t_c_estabelecimentos", type: "table", title: "Estabelecimentos", fields: ["estabelecimento", "uf_estabelecimento"], measures: [...debCred, "saldo_documentos"], limit: 300, span: 12, where: inC },
      ].map((v) => ({ ...v, fact: "bloco_c_resumo" })),
      ...[
        { id: "t_c_itens", type: "table", title: "Itens", fields: ["item", "ncm"], measures: ["receita", "receita_nao_tributada", "aquisicoes_com_credito", "pis_debito", "cofins_debito", "pis_credito", "cofins_credito"], limit: 300, span: 12, where: inC },
        { id: "b_c_ncm", type: "bar", title: "Receita por NCM", field: "ncm", measures: ["receita"], sort: "measure_desc", horizontal: true, limit: 20, span: 6, where: inC },
        { id: "b_c_ncm_credito", type: "bar", title: "Aquisições com crédito por NCM", field: "ncm", measures: ["aquisicoes_com_credito"], sort: "measure_desc", horizontal: true, limit: 20, span: 6, where: inC },
      ].map((v) => ({ ...v, fact: "bloco_c_resumo_itens" })),
    ],
  };
  // Bloco A, original data: every value of the items (A170) and of the notes (A100) added up by competência.
  // Labels are the layout's own field names, as in the listings below it.
  fields.push({ id: "competencia", label: "Competência", sql: `strftime(${F}.periodo, '%Y-%m')` });
  const totalsA: Measure[] = [
    { id: "a_notas", label: "Notas (A100)", sql: countWhen(notaValida), format: "integer" },
    { id: "a_itens", label: "Itens (A170)", sql: countWhen(isA170), format: "integer" },
    { id: "a_vl_doc", label: "VL_DOC", sql: nota("VL_DOC"), format: "currency_exact" },
    ...["VL_ITEM", "VL_DESC", "VL_BC_PIS", "VL_PIS", "VL_BC_COFINS", "VL_COFINS"].map((name): Measure => (
      { id: `a_${name.toLowerCase()}`, label: name, sql: itemServico(name), format: "currency_exact" }
    )),
    ...["VL_PIS_RET", "VL_COFINS_RET", "VL_ISS"].map((name): Measure => (
      { id: `a_${name.toLowerCase()}`, label: name, sql: nota(name), format: "currency_exact" }
    )),
  ];
  measures.push(...totalsA);
  const totalsByCompetencia: Json = {
    id: "t_a_competencia", type: "table", title: "Totais por competência: itens (A170) e notas (A100)",
    fields: ["competencia"], measures: totalsA.map((m) => m.id), sort: "field_desc", total: true, limit: 240, span: 12,
    where: isReg("A100", "A170"), fact: "bloco_a_servicos",
  };
  // The same values note by note: one line per NFS-e (A100) with its items (A170) added up beside it.
  // A line is the note's number in its file (its items carry it too, from the note above them); the key is
  // written only on the note, so it is a measure shown first instead of a field.
  fields.push(
    { id: "a_num_doc", label: "NUM_DOC", sql: `${F}.doc` },
    { id: "a_dt_doc", label: "DT_DOC", sql: `strftime(${F}.dt_doc, '%Y-%m-%d')` },
  );
  const noteValues: Measure[] = ["VL_DESC", "VL_BC_PIS", "VL_PIS", "VL_BC_COFINS", "VL_COFINS"].map((name): Measure => (
    { id: `n_${name.toLowerCase()}`, label: `${name} (A100)`, sql: nota(name), format: "currency_exact" }
  ));
  const itemValues: Measure[] = ["VL_ITEM", "VL_DESC", "VL_BC_PIS", "VL_PIS", "VL_BC_COFINS", "VL_COFINS"].map((name): Measure => (
    { id: `i_${name.toLowerCase()}`, label: `${name} (A170)`, sql: itemServico(name), format: "currency_exact" }
  ));
  measures.push(
    { id: "a_chv_nfse", label: "CHV_NFSE", sql: `COALESCE(max(CASE WHEN ${notaValida} THEN ${a100("CHV_NFSE")} END), '(sem chave)')`, format: "text" },
    ...noteValues,
    ...itemValues,
  );
  const byNoteTable: Json = {
    id: "t_a_nota", type: "table", title: "Notas de serviço: a nota (A100) e a soma dos seus itens (A170)",
    fields: ["competencia", "a_num_doc", "a_dt_doc", "participante"],
    leading: ["a_chv_nfse"],
    measures: [
      "a_chv_nfse", "a_vl_doc", ...noteValues.map((m) => m.id), "a_vl_pis_ret", "a_vl_cofins_ret", "a_vl_iss",
      "a_itens", ...itemValues.map((m) => m.id),
    ],
    sort: "field_desc", total: true, limit: 5000, span: 12,
    // The valid notes and the items (a cancelled note has none).
    where: `(${isA170} OR ${notaValida})`, fact: "bloco_a_servicos",
  };
  /** The bloco A section reads the fact that holds that block for every period. */
  const servico = (v: Json): Json => ({ ...v, fact: "bloco_a_servicos" });
  const servicos: Section = {
    id: "servicos_bloco_a", title: "Serviços (bloco A)",
    description: "Notas fiscais de serviço (A100) e seus itens (A170) de todos os períodos enviados, lidos de uma tabela só com o bloco A. Notas canceladas ficam fora dos valores. PIS, COFINS, retenções e ISS são os informados em cada nota.",
    visuals: [
      kpi("k_serv_valor", "Valor dos serviços", "serv_valor", 3, isA100), kpi("k_serv_notas", "Notas de serviço", "serv_notas", 3, isA100),
      kpi("k_serv_ticket", "Valor médio por nota", "serv_ticket", 3, isA100), kpi("k_serv_canceladas", "Notas canceladas", "serv_canceladas", 3, isA100),
      kpi("k_serv_pis", "PIS", "serv_pis", 3, isA100), kpi("k_serv_cofins", "COFINS", "serv_cofins", 3, isA100),
      kpi("k_serv_retencoes", "PIS + COFINS retidos na fonte", "serv_retencoes", 3, isA100), kpi("k_serv_iss", "ISS", "serv_iss", 3, isA100),
      { id: "b_serv_mes", type: "bar", title: "Serviços prestados e contratados por mês", field: "mes", measures: ["serv_prestados", "serv_contratados"], sort: "field", limit: 240, span: 12, where: isA100 },
      { id: "l_serv_tributos_mes", type: "line", title: "PIS + COFINS, retenções e ISS por mês", field: "mes", measures: ["serv_pis_cofins", "serv_retencoes", "serv_iss"], sort: "field", limit: 240, span: 8, where: isA100 },
      { id: "d_serv_situacao", type: "donut", title: "Notas por situação", field: "servico_situacao", measure: "linhas", span: 4, where: isA100 },
      { id: "t_serv_ano", type: "table", title: "Serviços por ano", fields: ["ano", "servico_operacao"], measures: ["serv_valor", "serv_notas", "serv_desconto", "serv_base_pis", "serv_pis", "serv_cofins", "serv_pis_retido", "serv_cofins_retido", "serv_iss", "serv_carga"], limit: 60, span: 12, where: isA100 },
      { id: "t_serv_participantes", type: "table", title: "Tomadores e prestadores", fields: ["participante", "uf_participante", "servico_operacao"], measures: ["serv_valor", "serv_notas", "serv_pis", "serv_cofins", "serv_retencoes", "serv_iss"], limit: 200, span: 12, where: isA100 },
      { id: "b_serv_itens", type: "bar", title: "Valor por serviço (itens A170)", field: "item", measures: ["serv_itens_valor"], sort: "measure_desc", horizontal: true, limit: 15, span: 12, where: isA170 },
      { id: "t_serv_estabelecimentos", type: "table", title: "Serviços por estabelecimento", fields: ["estabelecimento"], measures: ["serv_valor", "serv_notas", "serv_pis", "serv_cofins", "serv_iss"], limit: 100, span: 12, where: isA100 },
      { id: "t_serv_conferencia", type: "table", title: "Conferência: valor da nota (A100) e soma dos itens (A170)", fields: ["mes", "nota_servico", "participante"], measures: ["serv_diferenca", "serv_valor", "serv_itens_liquido"], limit: 100, span: 12, where: isReg("A100", "A170") },
      {
        id: "r_serv_notas", type: "rows", title: "Notas de serviço (A100), como estão nos arquivos", span: 12, where: isA100, hideEmpty: true,
        orderBy: `${F}.arquivo, ${F}.linha`, limit: 50, expand: { filter: "mes", limit: 2000 },
        columns: [
          { label: "Arquivo", sql: `${F}.arquivo` }, { label: "Estabelecimento", sql: `${F}.cnpj` }, { label: "Participante", sql: "participantes.nome" },
          ...["IND_OPER", "COD_SIT", "SER", "NUM_DOC", "CHV_NFSE", "DT_DOC", "DT_EXE_SERV", "VL_DOC", "VL_DESC", "VL_BC_PIS", "VL_PIS", "VL_BC_COFINS", "VL_COFINS", "VL_PIS_RET", "VL_COFINS_RET", "VL_ISS"]
            .map((name) => ({ label: name, sql: a100(name) })),
        ],
      },
    ].map(servico),
  };
  // The items of the services (A170) by how they are taxed: CST, rates, the tax worked out again, credits, accounts.
  const credItem = `${isA170} AND ${a170("CST_COFINS")} BETWEEN '50' AND '66'`;
  const servicosTributacao: Section = {
    id: "servicos_tributacao", title: "Serviços: CST, alíquotas e conferência",
    description: "Os itens das notas de serviço (A170) pela tributação: o valor por CST de PIS e COFINS, as alíquotas como estão nos arquivos, "
      + "o PIS e a COFINS refeitos item a item (base × alíquota) contra o informado, os créditos dos serviços contratados e as contas contábeis. Todos os períodos enviados.",
    visuals: [
      { ...kpi("k_st_tributado", "Tributado", "serv_itens_tributado", 2, isA170), detail: { text: "CST 01 a 05" } },
      { ...kpi("k_st_nao_tributado", "Não tributado e outras", "serv_itens_nao_tributado", 2, isA170), detail: { text: "CST 04, 06 a 09 e 49" } },
      { ...kpi("k_st_credito", "Contratado com crédito", "serv_itens_credito", 2, isA170), detail: { text: "CST 50 a 66" } },
      { ...kpi("k_st_aliq_cofins", "Alíquota efetiva da COFINS", "serv_itens_aliq_cofins", 2, isA170), detail: { text: "COFINS ÷ base" } },
      { ...kpi("k_st_carga", "PIS + COFINS sobre o valor", "serv_itens_carga", 2, isA170), detail: { text: "dos itens" } },
      { ...kpi("k_st_dif_calculo", "Itens com diferença de cálculo", "serv_itens_dif_calculo", 2, isA170), detail: { measure: "serv_dif_calculo", text: "acima de 1 centavo" } },
      {
        id: "t_st_cst_cofins", type: "table", title: "Valor e COFINS por CST", fields: ["cst_cofins_desc"],
        measures: ["serv_itens_valor", "serv_itens_qtd", "serv_itens_base_cofins", "serv_itens_cofins", "serv_itens_aliq_cofins"], total: true, limit: 40, span: 7, where: isA170,
      },
      { id: "d_st_cst_cofins", type: "donut", title: "Valor dos itens por CST da COFINS", field: "cst_cofins_desc", measure: "serv_itens_valor", span: 5, where: isA170 },
      { id: "l_st_mes", type: "line", title: "Tributado e não tributado por mês", field: "mes", measures: ["serv_itens_tributado", "serv_itens_nao_tributado", "serv_itens_credito"], sort: "field", limit: 240, span: 12, where: isA170 },
      {
        id: "t_st_calculo", type: "table", title: "Conferência do cálculo por mês: base × alíquota contra o informado", fields: ["mes"],
        measures: ["serv_itens_base_cofins", "serv_cofins_calculada", "serv_itens_cofins", "serv_pis_calculado", "serv_itens_pis", "serv_itens_dif_calculo", "serv_dif_calculo"],
        sort: "field_desc", total: true, limit: 240, span: 12, where: isA170,
      },
      {
        id: "t_st_cst_pis", type: "table", title: "Valor e PIS por CST", fields: ["cst_pis_desc"],
        measures: ["serv_itens_valor", "serv_itens_qtd", "serv_itens_base", "serv_itens_pis", "serv_itens_aliq_pis"], total: true, limit: 40, span: 12, where: isA170,
      },
      {
        id: "t_st_aliquotas", type: "table", title: "Alíquotas por CST", fields: ["servico_aliquotas", "cst_cofins_desc"],
        measures: ["serv_itens_valor", "serv_itens_qtd", "serv_itens_pis", "serv_itens_cofins"], limit: 60, span: 12, where: isA170,
      },
      {
        id: "t_st_servico_cst", type: "table", title: "Serviços por CST e alíquota", fields: ["item", "cst_cofins_desc", "servico_aliquotas"],
        measures: ["serv_itens_valor", "serv_itens_qtd", "serv_itens_pis", "serv_itens_cofins", "serv_itens_carga"], limit: 200, span: 12, where: isA170,
      },
      {
        id: "t_st_participante_cst", type: "table", title: "Tomadores e prestadores por CST", fields: ["participante", "cst_cofins_desc"],
        measures: ["serv_itens_valor", "serv_itens_qtd", "serv_itens_pis", "serv_itens_cofins"], limit: 200, span: 12, where: isA170,
      },
      { id: "d_st_pagamento", type: "donut", title: "Valor das notas por forma de pagamento", field: "servico_pagamento", measure: "serv_valor", span: 6, where: isA100 },
      { id: "d_st_emitente", type: "donut", title: "Valor das notas por emitente", field: "servico_emitente", measure: "serv_valor", span: 6, where: isA100 },
      {
        id: "t_st_credito", type: "table", title: "Créditos dos serviços contratados: natureza, origem e CST", fields: ["nat_bc_cred", "servico_origem_credito", "cst_cofins_desc"],
        measures: ["serv_itens_valor", "serv_itens_base", "serv_itens_pis", "serv_itens_cofins"], total: true, limit: 100, span: 12, where: credItem, hideEmpty: true,
      },
      {
        id: "t_st_contas", type: "table", title: "Contas contábeis e centros de custo", fields: ["servico_conta", "servico_centro_custo", "cst_cofins_desc"],
        measures: ["serv_itens_valor", "serv_itens_qtd", "serv_itens_pis", "serv_itens_cofins"], limit: 200, span: 12, where: isA170,
      },
    ].map(servico),
    strip: ["t_st_cst_pis", "t_st_aliquotas", "t_st_servico_cst", "t_st_participante_cst", "d_st_pagamento", "d_st_emitente", "t_st_credito", "t_st_contas"],
  };
  const mx = isReg("M200", "M600");
  const panels: Section[] = [
    {
      id: "visao_geral", title: "Visão geral",
      description: "Receitas, débitos e créditos somados item a item dos blocos A, C, D e F, de todos os períodos enviados. Os valores a recolher vêm da apuração (M200 e M600).",
      visuals: [
        kpi("k_receita", "Receita", "receita", 3, det), kpi("k_receita_tributada", "Receita tributada", "receita_tributada", 3, det),
        kpi("k_receita_nao_tributada", "Receita não tributada", "receita_nao_tributada", 3, det), kpi("k_aquisicoes_credito", "Aquisições com crédito", "aquisicoes_com_credito", 3, det),
        kpi("k_pis_debito", "PIS a débito", "pis_debito", 3, det), kpi("k_pis_credito", "PIS a crédito", "pis_credito", 3, det),
        kpi("k_cofins_debito", "COFINS a débito", "cofins_debito", 3, det), kpi("k_cofins_credito", "COFINS a crédito", "cofins_credito", 3, det),
        kpi("k_pis_recolher", "PIS a recolher (M200)", "pis_recolher", 4, m200), kpi("k_cofins_recolher", "COFINS a recolher (M600)", "cofins_recolher", 4, m600),
        kpi("k_carga", "Carga sobre a receita", "carga_receita", 4, det),
        { id: "b_mes", type: "bar", title: "Débitos e créditos de PIS e COFINS por mês", field: "mes", measures: ["pis_debito", "cofins_debito", "pis_credito", "cofins_credito"], sort: "field", span: 12, where: det },
      ],
    },
    {
      id: "apuracao", title: "Apuração", description: "Consolidação do período nos registros M200 (PIS) e M600 (COFINS).",
      visuals: [
        { id: "t_apuracao", type: "table", title: "Apuração por mês", fields: ["mes"], measures: ["pis_apurado", "pis_credito_descontado", "pis_recolher", "cofins_apurado", "cofins_credito_descontado", "cofins_recolher"], limit: 120, span: 12, where: mx },
      ],
    },
    {
      id: "tributacao", title: "Tributação e créditos", description: "",
      visuals: [
        { id: "d_tributacao", type: "donut", title: "Receita por tributação", field: "tributacao_receita", measure: "receita", span: 5, where: `${det} AND ${deb}` },
        { id: "t_cst", type: "table", title: "CST de PIS e COFINS", fields: ["cst_pis", "cst_cofins"], measures: ["receita", "aquisicoes_com_credito", "pis_debito", "cofins_debito", "pis_credito", "cofins_credito"], limit: 100, span: 7, where: det },
        { id: "t_nat_credito", type: "table", title: "Créditos por natureza da base", fields: ["nat_bc_cred"], measures: ["base_credito", "pis_credito", "cofins_credito"], limit: 30, span: 6, where: `${det} AND ${cred}` },
        { id: "b_origem", type: "bar", title: "Receita e aquisições por origem", field: "bloco_origem", measures: ["receita", "aquisicoes_com_credito"], sort: "measure_desc", span: 6, where: det },
        { id: "t_cfop", type: "table", title: "CFOP", fields: ["operacao", "cfop"], measures: ["receita", "aquisicoes_com_credito", "pis_debito", "cofins_debito", "pis_credito", "cofins_credito"], limit: 150, span: 12, where: det },
      ],
    },
    {
      id: "estabelecimentos", title: "Estabelecimentos", description: "",
      visuals: [
        { id: "b_estabelecimentos", type: "bar", title: "Receita por estabelecimento", field: "estabelecimento", measures: ["receita"], sort: "measure_desc", horizontal: true, limit: 20, span: 6, where: det },
        { id: "b_uf", type: "bar", title: "Receita por UF do estabelecimento", field: "uf_estabelecimento", measures: ["receita", "aquisicoes_com_credito"], sort: "measure_desc", limit: 28, span: 6, where: det },
        { id: "t_estabelecimentos", type: "table", title: "Estabelecimentos", fields: ["estabelecimento", "uf_estabelecimento"], measures: ["receita", "pis_debito", "cofins_debito", "pis_credito", "cofins_credito", "saldo_documentos"], limit: 300, span: 12, where: det },
      ],
    },
    {
      id: "itens_participantes", title: "Itens e participantes", description: "",
      visuals: [
        { id: "t_itens", type: "table", title: "Itens", fields: ["item", "ncm"], measures: ["receita", "receita_nao_tributada", "aquisicoes_com_credito", "pis_debito", "cofins_debito", "pis_credito", "cofins_credito"], limit: 200, span: 12, where: det },
        { id: "t_participantes", type: "table", title: "Participantes", fields: ["participante", "uf_participante"], measures: ["receita", "aquisicoes_com_credito", "pis_credito", "cofins_credito"], limit: 100, span: 12, where: det },
      ],
    },
    servicos,
    servicosTributacao,
    {
      id: "apuracao_periodos", title: "Apuração de todos os períodos (bloco M)",
      description: "Consolidação de PIS (M200) e COFINS (M600) e receita bruta do detalhamento (M210 e M610) de todos os períodos enviados, lidas de uma tabela só com o bloco M.",
      visuals: [
        kpi("k_m_pis_apurado", "PIS apurado não cumulativo", "pis_apurado", 3, m200), kpi("k_m_pis_credito", "Crédito de PIS descontado", "pis_credito_descontado", 3, m200),
        kpi("k_m_pis_recolher", "PIS a recolher", "pis_recolher", 3, m200), kpi("k_m_receita_bruta", "Receita bruta (M210)", "m_receita_bruta_pis", 3, isReg("M210")),
        kpi("k_m_cofins_apurado", "COFINS apurada não cumulativa", "cofins_apurado", 3, m600), kpi("k_m_cofins_credito", "Crédito de COFINS descontado", "cofins_credito_descontado", 3, m600),
        kpi("k_m_cofins_recolher", "COFINS a recolher", "cofins_recolher", 3, m600), kpi("k_m_credito_periodo", "Créditos apurados no período (M100 + M500)", "m_credito_periodo", 3, isReg("M100", "M500")),
        { id: "b_m_recolher_mes", type: "bar", title: "PIS e COFINS a recolher por mês", field: "mes", measures: ["pis_recolher", "cofins_recolher"], sort: "field", limit: 240, span: 12, where: mx },
        { id: "l_m_apurado_credito_mes", type: "line", title: "Contribuição apurada e crédito descontado por mês", field: "mes", measures: ["m_apurado", "m_credito_descontado"], sort: "field", limit: 240, span: 12, where: mx },
        { id: "t_m_ano", type: "table", title: "Apuração por ano", fields: ["ano"], measures: ["pis_apurado", "pis_credito_descontado", "pis_recolher", "cofins_apurado", "cofins_credito_descontado", "cofins_recolher"], orderBy: "cofins_recolher", limit: 30, span: 12, where: mx },
        { id: "t_m_mes", type: "table", title: "Apuração por mês", fields: ["mes"], measures: ["pis_apurado", "pis_credito_descontado", "pis_recolher", "cofins_apurado", "cofins_credito_descontado", "cofins_recolher"], limit: 240, span: 12, where: mx },
        { id: "t_m_cod_cont", type: "table", title: "Receita bruta por código de contribuição (M210 e M610)", fields: ["m_cod_cont"], measures: ["m_receita_bruta_pis", "m_receita_bruta_cofins"], limit: 40, span: 6, where: isReg("M210", "M610") },
        { id: "t_m_cod_cred", type: "table", title: "Créditos apurados por tipo (M100 e M500)", fields: ["m_cod_cred"], measures: ["m_credito_pis", "m_credito_cofins"], limit: 40, span: 6, where: isReg("M100", "M500") },
      ].map((v) => ({ ...v, fact: "bloco_m_apuracao_pis_cofins" })),
    },
    blockPanel("D", "bloco_d_transporte_comunicacao", "transporte_bloco_d", "Transporte e comunicação (bloco D)",
      "Documentos de transporte e de comunicação de todos os períodos enviados (D100 e D500 com seus complementos de PIS e COFINS), lidos de uma tabela só com o bloco D."),
    mercadorias,
    blockPanel("F", "bloco_f_demais_operacoes", "demais_operacoes_bloco_f", "Demais documentos e operações (bloco F)",
      "Demais operações geradoras de contribuição e de crédito de todos os períodos enviados (F100, bens do imobilizado, retenções), lidas de uma tabela só com o bloco F."),
  ];
  // The general panels read every period from the table made for them (the main fact holds one file whole).
  const allPeriods = new Set(["visao_geral", "apuracao", "tributacao", "estabelecimentos"]);
  const panelsAllPeriods = panels.map((s) => (allPeriods.has(s.id)
    ? { ...s, visuals: s.visuals.map((v) => (v.fact ? v : { ...v, fact: "paineis_todos_periodos" })) }
    : s));
  return build(k, {
    name: "EFD Contribuições", area: "Fiscal",
    description: "Escrituração de PIS e COFINS completa: receitas, débitos, créditos e apuração em painéis, e todos os registros do arquivo com todos os campos para consulta.",
    fields, measures, filters: ["ano", "mes", "estabelecimento"], panels: panelsAllPeriods, panelGroup: "Painéis",
    lead: { A: [totalsByCompetencia, byNoteTable] },
    // By month, then note by note, side by side: the reader scrolls sideways from one to the other.
    // The raw lines of bloco A (A001 … A990) say little on their own: its section is its totals.
    leadOnly: new Set(["A"]),
  });
}

// ------------------------------------------------------------------ ECD

/**
 * The income statement (DRE) of the ECD: the result accounts classified by their referential account (I051,
 * the Receita's chart, the same for every company), the financial ones also by the name of their group in the
 * company's own chart (a company may tie its interest to another referential account). Each group line takes
 * what no earlier line took; "outras" catches the rest, so the net result always matches the J150.
 */
function dreLines(): { id: string; label: string; icon: string; where?: string; sum?: string[]; optional?: boolean }[] {
  const ref = "COALESCE(plano_contas.cod_cta_ref, '')";
  const refIs = (...prefixes: string[]): string => `(${prefixes.map((p) => `${ref} LIKE '${p}%'`).join(" OR ")})`;
  const named = (word: string): string =>
    `(${["grupo_2", "grupo_3", "conta_sintetica"].map((c) => `upper(COALESCE(plano_contas.${c}, '')) LIKE '%${word}%'`).join(" OR ")})`;
  const financial = `((${refIs("3.01.01.05.01.05", "3.01.01.09.01.08")} OR ${named("FINANCEIR")}) AND NOT ${refIs("3.01.05", "3.02")})`;
  const notFinancial = (cond: string): string => `${cond} AND NOT ${financial}`;
  return [
    { id: "receita_bruta", label: "Receita bruta", icon: "receita", where: notFinancial(refIs("3.01.01.01.01")) },
    { id: "deducoes", label: "(-) Deduções da receita", icon: "deducao", where: notFinancial(refIs("3.01.01.01.02")) },
    { id: "receita_liquida", label: "Receita líquida", icon: "resultado", sum: ["receita_bruta", "deducoes"] },
    { id: "custos", label: "(-) Custos das vendas e serviços", icon: "custo", where: notFinancial(refIs("3.01.01.03")) },
    { id: "lucro_bruto", label: "Lucro bruto", icon: "lucro", sum: ["receita_liquida", "custos"] },
    { id: "despesas_operacionais", label: "(-) Despesas operacionais", icon: "despesa", where: notFinancial(refIs("3.01.01.07")) },
    { id: "outras_despesas_operacionais", label: "(-) Outras despesas operacionais", icon: "despesa", where: notFinancial(refIs("3.01.01.09")) },
    { id: "outras_receitas_operacionais", label: "(+) Outras receitas operacionais", icon: "receita", where: notFinancial(refIs("3.01.01.05")) },
    { id: "resultado_operacional", label: "Resultado operacional", icon: "operacional", sum: ["lucro_bruto", "despesas_operacionais", "outras_despesas_operacionais", "outras_receitas_operacionais"] },
    { id: "resultado_financeiro", label: "(±) Resultado financeiro", icon: "financeiro", where: financial },
    { id: "outros_resultados", label: "(±) Outras receitas e despesas", icon: "outros", where: refIs("3.01.01.11") },
    { id: "participacoes", label: "(-) Participações", icon: "participacao", where: refIs("3.01.05") },
    { id: "outras_contas", label: "(±) Contas de resultado sem classificação", icon: "outros", where: `plano_contas.natureza = '04' AND NOT ${refIs("3.02")}`, optional: true },
    { id: "resultado_antes_ir", label: "Resultado antes do IR e da CSLL", icon: "resultado", sum: ["resultado_operacional", "resultado_financeiro", "outros_resultados", "participacoes", "outras_contas"] },
    { id: "ir_csll", label: "(-) IR e CSLL", icon: "imposto", where: refIs("3.02") },
    { id: "lucro_liquido", label: "Lucro líquido", icon: "lucro", sum: ["resultado_antes_ir", "ir_csll"] },
  ];
}

function ecd(): Json {
  const k = kindOf("ecd");
  const i155 = isReg("I155");
  const i200 = isReg("I200");
  const i250 = isReg("I250");
  const i355 = isReg("I355");
  const signed = (reg: string, value: string, dc: string): string =>
    `CASE WHEN ${col(k, reg, dc)} = 'C' THEN -${num(col(k, reg, value))} ELSE ${num(col(k, reg, value))} END`;
  const fin = signed("I155", "VL_SLD_FIN", "IND_DC_FIN");
  const ini = signed("I155", "VL_SLD_INI", "IND_DC_INI");
  // A balance is not added up over months: it is read at the latest month of what is selected (and the
  // opening balance at the earliest), so the page needs no month fixed in the filters. Each line of a visual
  // takes its own latest month — the month itself in a chart by month, the last one under the filters in a
  // total. One expression: the (month, value) pairs of the lines, those of the latest month, their sum.
  const monthNumber = `(year(${F}.periodo) * 100 + month(${F}.periodo))`;
  const atEdge = (edge: "MAX" | "MIN", cond: string, expr: string): string =>
    `list_sum(list_transform(list_filter(list(list_value(${monthNumber}, ${expr})) FILTER (WHERE ${cond}), `
    + `lambda e: list_extract(e, 1) = ${edge}(${monthNumber}) FILTER (WHERE ${i155})), lambda e: list_extract(e, 2)))`;
  const lastSum = (cond: string, expr: string): string => atEdge("MAX", cond, expr);
  const deb = num(col(k, "I155", "VL_DEB"));
  const cre = num(col(k, "I155", "VL_CRED"));
  const nat = (code: string): string => `${i155} AND plano_contas.natureza = '${code}'`;
  const vlDc = num(col(k, "I250", "VL_DC"));
  const dc = col(k, "I250", "IND_DC");

  const fields: Field[] = [
    { id: "mes", label: "Mês", sql: `strftime(${F}.periodo, '%Y-%m')` },
    { id: "ano", label: "Ano", sql: `CAST(year(${F}.periodo) AS VARCHAR)` },
    { id: "empresa", label: "Empresa", sql: "empresas.nome" },
    { id: "natureza", label: "Natureza", sql: "CASE plano_contas.natureza WHEN '01' THEN '1 - Ativo' WHEN '02' THEN '2 - Passivo' WHEN '03' THEN '3 - Patrimônio líquido' WHEN '04' THEN '4 - Resultado' WHEN '05' THEN '5 - Compensação' WHEN '09' THEN '9 - Outras' END" },
    { id: "grupo_1", label: "Grupo (nível 1)", sql: "plano_contas.grupo_1" },
    { id: "grupo_2", label: "Grupo (nível 2)", sql: "plano_contas.grupo_2" },
    { id: "grupo_3", label: "Grupo (nível 3)", sql: "plano_contas.grupo_3" },
    { id: "conta_sintetica", label: "Conta sintética", sql: "plano_contas.conta_sintetica" },
    { id: "conta", label: "Conta", sql: "concat(plano_contas.cod_cta, ' - ', plano_contas.nome)" },
    { id: "conta_referencial", label: "Conta referencial", sql: "plano_contas.cod_cta_ref" },
    { id: "dia", label: "Dia", sql: `strftime(${F}.dt_doc, '%Y-%m-%d')` },
    { id: "tipo_lancamento", label: "Tipo de lançamento", sql: `CASE ${col(k, "I200", "IND_LCTO")} WHEN 'N' THEN 'N - Normal' WHEN 'E' THEN 'E - Encerramento' WHEN 'X' THEN 'X - Extemporâneo' ELSE ${col(k, "I200", "IND_LCTO")} END` },
  ];
  const measures: Measure[] = [
    { id: "saldo_inicial", label: "Saldo inicial", sql: atEdge("MIN", i155, ini), format: "currency" },
    { id: "debitos", label: "Débitos", sql: sumWhen(i155, deb), format: "currency" },
    { id: "creditos", label: "Créditos", sql: sumWhen(i155, cre), format: "currency" },
    { id: "saldo_final", label: "Saldo final", sql: lastSum(i155, fin), format: "currency" },
    { id: "ativo", label: "Ativo", sql: lastSum(nat("01"), fin), format: "currency" },
    { id: "passivo", label: "Passivo", sql: `0 - ${lastSum(nat("02"), fin)}`, format: "currency" },
    { id: "patrimonio_liquido", label: "Patrimônio líquido", sql: `0 - ${lastSum(nat("03"), fin)}`, format: "currency" },
    { id: "resultado_acumulado", label: "Resultado acumulado", sql: `0 - ${lastSum(nat("04"), fin)}`, format: "currency" },
    { id: "resultado_mes", label: "Resultado do mês", sql: sumWhen(nat("04"), `${cre} - ${deb}`), format: "currency" },
    { id: "dif_movimento", label: "Débitos − créditos", sql: `ROUND(${nz(sumWhen(i155, deb))} - ${nz(sumWhen(i155, cre))}, 2) + 0`, format: "currency" },
    // Rounded to the cent, and + 0 so a rounded "-0" shows as zero.
    { id: "dif_saldos", label: "Devedores − credores", sql: `ROUND(COALESCE(${lastSum(i155, fin)}, 0), 2) + 0`, format: "currency" },
    { id: "saldos_devedores", label: "Saldos devedores", sql: lastSum(`${i155} AND (${fin}) > 0`, fin), format: "currency" },
    { id: "saldos_credores", label: "Saldos credores", sql: `0 - ${lastSum(`${i155} AND (${fin}) < 0`, fin)}`, format: "currency" },
    { id: "contas_movimentadas", label: "Contas movimentadas", sql: `COUNT(DISTINCT CASE WHEN ${i155} AND (${deb} <> 0 OR ${cre} <> 0) THEN ${F}.id_cta END)`, format: "integer" },
    { id: "resultado_antes_encerramento", label: "Resultado antes do encerramento", sql: `0 - ${sumWhen(i355, signed("I355", "VL_CTA", "IND_DC"))}`, format: "currency" },
    { id: "receitas_antes_encerramento", label: "Contas credoras (receitas)", sql: sumWhen(`${i355} AND ${col(k, "I355", "IND_DC")} = 'C'`, num(col(k, "I355", "VL_CTA"))), format: "currency" },
    { id: "despesas_antes_encerramento", label: "Contas devedoras (custos e despesas)", sql: sumWhen(`${i355} AND ${col(k, "I355", "IND_DC")} = 'D'`, num(col(k, "I355", "VL_CTA"))), format: "currency" },
    { id: "lancamentos", label: "Lançamentos", sql: countWhen(i200), format: "integer" },
    { id: "valor_lancado", label: "Valor lançado", sql: sumWhen(i200, num(col(k, "I200", "VL_LCTO"))), format: "currency" },
    { id: "partidas", label: "Partidas", sql: countWhen(i250), format: "integer" },
    { id: "partidas_debito", label: "Débitos das partidas", sql: sumWhen(`${i250} AND ${dc} = 'D'`, vlDc), format: "currency" },
    { id: "partidas_credito", label: "Créditos das partidas", sql: sumWhen(`${i250} AND ${dc} = 'C'`, vlDc), format: "currency" },
  ];
  // DRE: what each result account added to the result in the month, revenues positive. A month's movement is
  // its change in balance (I155); in the month the accounts are closed their final balance is already zero,
  // so the balance before closing (I355) stands in for it.
  const lines = dreLines();
  const result = "plano_contas.natureza = '04'";
  const dreValue = (cond?: string): string => {
    const c = cond ? ` AND (${cond})` : "";
    return `ROUND(COALESCE(SUM(CASE WHEN ${i155} AND ${result}${c} THEN (${ini}) - (${fin}) END), 0) - `
      + `COALESCE(SUM(CASE WHEN ${i355} AND ${result}${c} THEN ${signed("I355", "VL_CTA", "IND_DC")} END), 0), 2)`;
  };
  const linesOf = (...ids: string[]): string => ids.map((id) => `(${lines.find((l) => l.id === id)?.where ?? "FALSE"})`).join(" OR ");
  // The same, for the latest year of what is selected alone (the exercise the page shows): the (year, value)
  // pairs of the lines, those of the latest year, their sum — so the page needs no year fixed in the filters.
  const yearNumber = `year(${F}.periodo)`;
  const exercise = (cond?: string): string => {
    const c = cond ? ` AND (${cond})` : "";
    const value = `CASE WHEN ${i155} THEN (${ini}) - (${fin}) ELSE 0 - (${signed("I355", "VL_CTA", "IND_DC")}) END`;
    return `ROUND(COALESCE(list_sum(list_transform(list_filter(list(list_value(${yearNumber}, ${value})) FILTER (WHERE (${i155} OR ${i355}) AND ${result}${c}), `
      + `lambda e: list_extract(e, 1) = MAX(${yearNumber}) FILTER (WHERE ${i155})), lambda e: list_extract(e, 2))), 0), 2)`;
  };
  const OPERATING = ["despesas_operacionais", "outras_despesas_operacionais", "outras_receitas_operacionais"];
  const UP_TO_OPERATING = ["receita_bruta", "deducoes", "custos", ...OPERATING];
  const ratio = (a: string, b: string): string => `(${a}) / NULLIF(${b}, 0)`;
  const exerciseMeasures: Measure[] = [
    { id: "ex_ano", label: "Exercício", sql: `CAST(MAX(${yearNumber}) FILTER (WHERE ${i155}) AS VARCHAR)`, format: "text" },
    { id: "ex_receita_bruta", label: "Receita bruta", sql: exercise(linesOf("receita_bruta")), format: "currency" },
    { id: "ex_deducoes", label: "Deduções", sql: exercise(linesOf("deducoes")), format: "currency" },
    { id: "ex_receita_liquida", label: "Receita líquida", sql: exercise(linesOf("receita_bruta", "deducoes")), format: "currency" },
    { id: "ex_custos", label: "Custos", sql: exercise(linesOf("custos")), format: "currency" },
    { id: "ex_lucro_bruto", label: "Lucro bruto", sql: exercise(linesOf("receita_bruta", "deducoes", "custos")), format: "currency" },
    { id: "ex_despesas_operacionais", label: "Despesas operacionais", sql: exercise(linesOf(...OPERATING)), format: "currency" },
    { id: "ex_resultado_operacional", label: "Resultado operacional", sql: exercise(linesOf(...UP_TO_OPERATING)), format: "currency" },
    { id: "ex_resultado_financeiro", label: "Resultado financeiro", sql: exercise(linesOf("resultado_financeiro")), format: "currency" },
    { id: "ex_ir_csll", label: "IR e CSLL", sql: exercise(linesOf("ir_csll")), format: "currency" },
    // What is left (other revenues and expenses, profit sharing, accounts with no line): the result minus the rest,
    // so the steps always add up to it.
    {
      id: "ex_outros", label: "Outras receitas e despesas",
      sql: `(${exercise()}) - (${exercise(linesOf(...UP_TO_OPERATING, "resultado_financeiro", "ir_csll"))})`, format: "currency",
    },
    { id: "ex_resultado_antes_ir", label: "Resultado antes do IR e da CSLL", sql: `(${exercise()}) - (${exercise(linesOf("ir_csll"))})`, format: "currency" },
    { id: "ex_lucro_liquido", label: "Lucro líquido", sql: exercise(), format: "currency" },
    { id: "ex_margem_liquida", label: "Margem líquida", sql: ratio(exercise(), exercise(linesOf("receita_bruta", "deducoes"))), format: "percent" },
    { id: "ex_margem_bruta", label: "Margem bruta", sql: ratio(exercise(linesOf("receita_bruta", "deducoes", "custos")), exercise(linesOf("receita_bruta", "deducoes"))), format: "percent" },
    { id: "ex_valor", label: "Resultado", sql: exercise(), format: "currency" },
    // Year by year (a chart or a table by year): the lines of the DRE and what they are of the revenue.
    { id: "dre_despesas_operacionais", label: "Despesas operacionais", sql: dreValue(linesOf(...OPERATING)), format: "currency" },
    { id: "dre_resultado_operacional", label: "Resultado operacional", sql: dreValue(linesOf(...UP_TO_OPERATING)), format: "currency" },
    { id: "dre_resultado_financeiro", label: "Resultado financeiro", sql: dreValue(linesOf("resultado_financeiro")), format: "currency" },
    { id: "dre_ir_csll", label: "IR e CSLL", sql: dreValue(linesOf("ir_csll")), format: "currency" },
    { id: "margem_operacional", label: "Margem operacional", sql: ratio(dreValue(linesOf(...UP_TO_OPERATING)), dreValue(linesOf("receita_bruta", "deducoes"))), format: "percent" },
    { id: "peso_despesas", label: "Despesas operacionais sobre a receita", sql: ratio(`0 - ${dreValue(linesOf(...OPERATING))}`, dreValue(linesOf("receita_bruta", "deducoes"))), format: "percent" },
    { id: "aliquota_efetiva", label: "Alíquota efetiva de IR e CSLL", sql: ratio(`0 - ${dreValue(linesOf("ir_csll"))}`, `${dreValue()} - ${dreValue(linesOf("ir_csll"))}`), format: "percent" },
  ];
  const j150 = isReg("J150");
  // The J150 changed in the leiaute 7 (2019). The current one says which lines are totals (IND_COD_AGL T/D);
  // the old one — |J150|COD_AGL|NIVEL_AGL|DESCR_COD_AGL|VL_CTA|IND_VL|… — has no such field: there the third
  // field is the line's description. A file in the old layout is read by position, so it is told apart here.
  const j150Current = `${col(k, "J150", "IND_COD_AGL")} IN ('T', 'D')`;
  const j150Old = `${j150} AND NOT COALESCE(${j150Current}, false)`;
  const oldJ150 = { level: `${F}.${fieldColumn(2)}`, value: `${F}.${fieldColumn(4)}`, sign: `${F}.${fieldColumn(5)}` };
  // The J150's own net result. Current layout: its detail lines (IND_COD_AGL = D) added up, revenues positive.
  // Old layout: its top line (NIVEL_AGL 1, the net result), positive (P, R) or negative (N, D) — the detail
  // lines cannot be added up there, their sign does not always follow IND_VL.
  const j150Value = `CASE WHEN ${col(k, "J150", "IND_DC_CTA_FIN")} = 'C' THEN ${num(col(k, "J150", "VL_CTA_FIN"))} ELSE 0 - ${num(col(k, "J150", "VL_CTA_FIN"))} END`;
  const j150OldValue = `CASE WHEN ${oldJ150.sign} IN ('N', 'D') THEN 0 - ${num(oldJ150.value)} ELSE ${num(oldJ150.value)} END`;
  const j150Sum = `SUM(CASE WHEN ${j150} AND ${col(k, "J150", "IND_COD_AGL")} = 'D' THEN ${j150Value} WHEN ${j150Old} AND ${oldJ150.level} = '1' THEN ${j150OldValue} END)`;
  // A file without the J150 (most months of a company that only sends the statements in December) has nothing
  // to compare with: no value, instead of a result of zero and the whole month shown as a difference.
  const hasJ150 = `${countWhen(j150)} > 0`;
  const j150Result = `CASE WHEN ${hasJ150} THEN ROUND(COALESCE(${j150Sum}, 0), 2) END`;
  // The balance sheet by the referential chart of accounts (I051): 1.01 current assets, 1.02 non-current,
  // 2.01 current liabilities, 2.02 non-current, 2.03 equity. An account without a referential code falls back
  // on its nature for assets, liabilities and equity as a whole, and stays out of the current / non-current split.
  const refCode = "COALESCE(plano_contas.cod_cta_ref, '')";
  const bal = (cond: string): string => lastSum(`${i155} AND (${cond})`, fin);
  const isEquity = `(${refCode} LIKE '2.03%' OR (${refCode} = '' AND plano_contas.natureza = '03'))`;
  const assets = bal("plano_contas.natureza = '01'");
  const currentAssets = bal(`plano_contas.natureza = '01' AND ${refCode} LIKE '1.01%'`);
  const cash = bal(`plano_contas.natureza = '01' AND ${refCode} LIKE '1.01.01%'`);
  const longTermAssets = bal(`plano_contas.natureza = '01' AND ${refCode} LIKE '1.02.01%'`);
  const fixedAssets = bal(`plano_contas.natureza = '01' AND ${refCode} LIKE '1.02%' AND NOT ${refCode} LIKE '1.02.01%'`);
  const currentLiabilities = `(0 - ${bal(`${refCode} LIKE '2.01%'`)})`;
  const equity = `(0 - ${bal(isEquity)})`;
  const liabilities = `(0 - ${bal(`plano_contas.natureza IN ('02', '03') AND NOT ${isEquity}`)})`;
  const netRevenue = dreValue(linesOf("receita_bruta", "deducoes"));
  const over = (a: string, b: string): string => `(${a}) / NULLIF(${b}, 0)`;
  const indicatorMeasures: Measure[] = [
    { id: "pl_referencial", label: "Patrimônio líquido", sql: equity, format: "currency" },
    { id: "passivo_exigivel", label: "Passivo exigível", sql: liabilities, format: "currency" },
    { id: "capital_giro", label: "Capital de giro líquido", sql: `${currentAssets} - ${currentLiabilities}`, format: "currency" },
    { id: "liquidez_corrente", label: "Liquidez corrente", sql: over(currentAssets, currentLiabilities), format: "number" },
    { id: "liquidez_imediata", label: "Liquidez imediata", sql: over(cash, currentLiabilities), format: "number" },
    { id: "liquidez_geral", label: "Liquidez geral", sql: over(`${currentAssets} + ${longTermAssets}`, liabilities), format: "number" },
    { id: "endividamento_geral", label: "Endividamento geral", sql: over(liabilities, assets), format: "percent" },
    { id: "composicao_endividamento", label: "Composição do endividamento", sql: over(currentLiabilities, liabilities), format: "percent" },
    { id: "capital_terceiros", label: "Capital de terceiros sobre o patrimônio líquido", sql: over(liabilities, equity), format: "percent" },
    { id: "imobilizacao_pl", label: "Imobilização do patrimônio líquido", sql: over(fixedAssets, equity), format: "percent" },
    { id: "retorno_pl", label: "Retorno sobre o patrimônio líquido", sql: over(dreValue(), equity), format: "percent" },
    { id: "retorno_ativo", label: "Retorno sobre o ativo", sql: over(dreValue(), assets), format: "percent" },
    { id: "giro_ativo", label: "Giro do ativo", sql: over(netRevenue, assets), format: "number" },
  ];
  const dreMeasures: Measure[] = [
    { id: "valor_dre", label: "Valor", sql: dreValue(), format: "currency" },
    { id: "receita_liquida_dre", label: "Receita líquida", sql: dreValue(linesOf("receita_bruta", "deducoes")), format: "currency" },
    { id: "lucro_bruto_dre", label: "Lucro bruto", sql: dreValue(linesOf("receita_bruta", "deducoes", "custos")), format: "currency" },
    { id: "lucro_liquido_j150", label: "Lucro líquido no J150", sql: j150Result, format: "currency" },
    { id: "diferenca_j150", label: "Diferença para o J150", sql: `CASE WHEN ${hasJ150} THEN ROUND(${dreValue()} - ${j150Result}, 2) END`, format: "currency" },
    { id: "meses_com_j150", label: "Meses com J150", sql: `COUNT(DISTINCT CASE WHEN ${j150} THEN ${F}.arquivo END)`, format: "integer" },
    // The size of the company, for the overview: the result under a name of its own and what it is of the revenue.
    { id: "resultado_dre", label: "Resultado", sql: dreValue(), format: "currency" },
    { id: "margem_liquida", label: "Margem líquida", sql: `(${dreValue()}) / NULLIF(${dreValue(linesOf("receita_bruta", "deducoes"))}, 0)`, format: "percent" },
    { id: "margem_bruta", label: "Margem bruta", sql: `(${dreValue(linesOf("receita_bruta", "deducoes", "custos"))}) / NULLIF(${dreValue(linesOf("receita_bruta", "deducoes"))}, 0)`, format: "percent" },
    { id: "endividamento", label: "Endividamento", sql: `(0 - ${lastSum(nat("02"), fin)}) / NULLIF(${lastSum(nat("01"), fin)}, 0)`, format: "percent" },
    ...indicatorMeasures,
    ...exerciseMeasures,
  ];
  const dreRegs = isReg("I155", "I355");
  const annual = { skipFilters: ["mes", "natureza"] };
  const dreSection: Section = {
    id: "dre", title: "Demonstração do resultado (DRE)",
    description: "Receitas, custos e despesas do período, mês a mês. Cada conta de resultado entra na linha da sua conta referencial (I051); "
      + "as financeiras também pelo nome do seu grupo no plano de contas. Abra uma linha para descer até o grupo, a conta sintética e a conta analítica. "
      + "O lucro líquido é conferido com o J150, mês a mês, nos arquivos que trazem essa demonstração.",
    visuals: [
      { ...kpi("k_dre_receita_liquida", "Receita líquida", "receita_liquida_dre", 3, dreRegs), ...annual },
      { ...kpi("k_dre_lucro_bruto", "Lucro bruto", "lucro_bruto_dre", 3, dreRegs), ...annual },
      { ...kpi("k_dre_lucro_liquido", "Lucro líquido", "valor_dre", 3, dreRegs), ...annual },
      { ...kpi("k_dre_meses_j150", "Meses com J150 no arquivo", "meses_com_j150", 3, j150), ...annual },
      {
        id: "s_dre", type: "statement", title: "DRE gerencial", span: 12, where: `${dreRegs} AND ${result}`, ...annual,
        measure: "valor_dre", column: "mes", yearly: true, levels: ["grupo_3", "conta_sintetica", "conta"], base: "receita_liquida", lines,
      },
      // The check, month by month: a total over several months would count as a difference every month whose
      // file has no J150 (a query cannot leave those months out of one sum).
      {
        id: "t_dre_j150", type: "table", title: "Conferência com o J150, mês a mês", span: 12, ...annual,
        fields: ["mes"], measures: ["valor_dre", "lucro_liquido_j150", "diferenca_j150"], sort: "field", limit: 400,
        where: isReg("I155", "I355", "J150"),
      },
    ],
  };
  const demo = (id: string, reg: string, title: string, names: string[], where = isReg(reg)): Json => ({
    id, type: "rows", title, span: 12, where, hideEmpty: true, skipFilters: ["mes", "natureza"],
    orderBy: `${F}.arquivo, ${F}.linha`, limit: 500,
    columns: names.map((n) => ({ label: n, sql: col(k, reg, n) })),
  });
  // The J150 of the files in the old layout, with the fields where that layout has them.
  const oldDre: Json = {
    id: "r_dre_antigo", type: "rows", title: "Demonstração do resultado (J150, leiaute até 2018)", span: 12, where: j150Old,
    hideEmpty: true, skipFilters: ["mes", "natureza"], orderBy: `${F}.arquivo, ${F}.linha`, limit: 500,
    columns: ["COD_AGL", "NIVEL_AGL", "DESCR_COD_AGL", "VL_CTA", "IND_VL", "VL_CTA_ULT_DRE", "IND_VL_ULT_DRE"]
      .map((label, i) => ({ label, sql: `${F}.${fieldColumn(i + 1)}` })),
  };
  const panels: Section[] = [
    {
      id: "visao_geral", title: "Visão geral",
      description: "O tamanho da empresa no período dos filtros (sem filtro, tudo o que foi escriturado): receita, resultado e margens somam o período, e a posição patrimonial é a do último mês dele (saldos periódicos, I155). "
        + "O gráfico mostra todos os meses; um clique num mês leva os indicadores para ele. Os quadros lado a lado, abaixo, trazem a evolução por ano, o patrimônio e a composição.",
      visuals: [
        kpi("k_receita_liquida", "Receita líquida", "receita_liquida_dre", 2, dreRegs), kpi("k_resultado_mes", "Resultado", "resultado_dre", 2, dreRegs),
        kpi("k_margem_liquida", "Margem líquida", "margem_liquida", 2, dreRegs), kpi("k_ativo", "Ativo", "ativo", 2, i155),
        kpi("k_pl", "Patrimônio líquido", "pl_referencial", 2, i155), kpi("k_endividamento", "Endividamento (passivo ÷ ativo)", "endividamento_geral", 2, i155),
        kpi("k_lucro_bruto", "Lucro bruto", "lucro_bruto_dre", 2, dreRegs), kpi("k_margem_bruta", "Margem bruta", "margem_bruta", 2, dreRegs),
        kpi("k_passivo", "Passivo exigível", "passivo_exigivel", 2, i155), kpi("k_debitos", "Débitos", "debitos", 2, i155),
        kpi("k_creditos", "Créditos", "creditos", 2, i155), kpi("k_contas", "Contas movimentadas", "contas_movimentadas", 2, i155),
        {
          id: "l_resultado_mes", type: "line", title: "Evolução do resultado: receita líquida e resultado por mês (clique num mês para filtrar)",
          field: "mes", measures: ["receita_liquida_dre", "resultado_dre"], sort: "field", limit: 400, span: 12, where: dreRegs, skipFilters: ["mes"],
        },
        { id: "b_resultado_ano", type: "bar", title: "Receita líquida e resultado por ano", field: "ano", measures: ["receita_liquida_dre", "resultado_dre"], sort: "field", limit: 40, span: 12, where: dreRegs, skipFilters: ["mes", "ano"] },
        { id: "l_patrimonio_mes", type: "line", title: "Ativo e patrimônio líquido ao fim de cada mês", field: "mes", measures: ["ativo", "pl_referencial"], sort: "field", limit: 400, span: 12, where: i155, skipFilters: ["mes"] },
        { id: "d_ativo", type: "donut", title: "Composição do ativo", field: "grupo_2", measure: "ativo", span: 12, where: nat("01") },
        { id: "d_passivo", type: "donut", title: "Composição do passivo e do patrimônio líquido", field: "grupo_2", measure: "saldo_credor", span: 12, where: `${i155} AND plano_contas.natureza IN ('02', '03')` },
        { id: "b_resultado_grupo_mes", type: "bar", title: "O que formou o resultado do período, por grupo de contas", field: "grupo_3", measures: ["resultado_dre"], sort: "measure_desc", horizontal: true, limit: 25, span: 12, where: `${dreRegs} AND ${result}` },
        {
          id: "t_resultado_meses", type: "table", title: "Receita, lucro bruto, resultado e margem, mês a mês", fields: ["mes"],
          measures: ["receita_liquida_dre", "lucro_bruto_dre", "resultado_dre", "margem_liquida"], sort: "field_desc", limit: 400, span: 12, where: dreRegs, skipFilters: ["mes"],
        },
      ],
      strip: ["b_resultado_ano", "l_patrimonio_mes", "d_ativo", "d_passivo", "b_resultado_grupo_mes", "t_resultado_meses"],
    },
    {
      id: "indicadores", title: "Indicadores",
      description: "Os indicadores que a escrituração permite calcular, lado a lado: o minigráfico mostra os últimos 36 meses e o valor é o do mês mais recente. "
        + "Ativo e passivo circulantes, não circulantes e patrimônio líquido seguem o plano de contas referencial (I051); receita e resultado são os da DRE. "
        + "Os índices de resultado são do mês, não anualizados. As referências são as usuais de análise de balanço, não metas da empresa.",
      visuals: [{
        id: "sc_indicadores", type: "scorecard", title: "Indicadores da empresa, mês a mês", span: 12, field: "mes", limit: 36,
        where: dreRegs, skipFilters: ["mes", "natureza"],
        items: [
          { measure: "receita_liquida_dre", group: "Porte", note: "Receita bruta menos deduções, no mês." },
          { measure: "resultado_dre", label: "Resultado do mês", group: "Porte", note: "Lucro ou prejuízo do mês.", better: "higher" },
          { measure: "ativo", label: "Ativo total", group: "Porte", note: "Saldo ao fim do mês." },
          { measure: "pl_referencial", group: "Porte", note: "Capital próprio ao fim do mês.", better: "higher" },
          { measure: "margem_bruta", group: "Rentabilidade", note: "Lucro bruto ÷ receita líquida.", better: "higher" },
          { measure: "margem_liquida", group: "Rentabilidade", note: "Resultado ÷ receita líquida.", better: "higher" },
          { measure: "retorno_pl", group: "Rentabilidade", note: "Resultado do mês ÷ patrimônio líquido.", better: "higher" },
          { measure: "retorno_ativo", group: "Rentabilidade", note: "Resultado do mês ÷ ativo total.", better: "higher" },
          { measure: "giro_ativo", group: "Rentabilidade", note: "Receita líquida do mês ÷ ativo total." },
          { measure: "liquidez_corrente", group: "Liquidez", note: "Ativo circulante ÷ passivo circulante.", target: 1, better: "higher" },
          { measure: "liquidez_imediata", group: "Liquidez", note: "Disponível ÷ passivo circulante.", better: "higher" },
          { measure: "liquidez_geral", group: "Liquidez", note: "(Ativo circulante + realizável a longo prazo) ÷ passivo exigível.", target: 1, better: "higher" },
          { measure: "capital_giro", group: "Liquidez", note: "Ativo circulante − passivo circulante.", better: "higher" },
          { measure: "endividamento_geral", group: "Estrutura de capital", note: "Passivo exigível ÷ ativo total.", target: 0.5, better: "lower" },
          { measure: "composicao_endividamento", group: "Estrutura de capital", note: "Passivo circulante ÷ passivo exigível: quanto da dívida vence no curto prazo.", target: 0.5, better: "lower" },
          { measure: "capital_terceiros", group: "Estrutura de capital", note: "Passivo exigível ÷ patrimônio líquido.", target: 1, better: "lower" },
          { measure: "imobilizacao_pl", group: "Estrutura de capital", note: "Ativo não circulante (sem o realizável a longo prazo) ÷ patrimônio líquido.", target: 1, better: "lower" },
        ],
      }],
    },
    dreSection,
    {
      id: "balancete", title: "Balancete",
      description: "O balancete em árvore, como o plano de contas: cada grupo abre nas contas, com a soma do que está nele, e os saldos com o lado (D ou C). "
        + "Os saldos são o inicial do primeiro mês e o final do último mês da seleção; débitos e créditos somam o período. "
        + "Em cima, as duas provas do balancete: débitos iguais aos créditos e saldos devedores iguais aos credores (a diferença deve ser zero).",
      visuals: [
        { ...kpi("k_bal_debitos", "Débitos", "debitos", 2, i155), detail: { text: "no período" } },
        { ...kpi("k_bal_creditos", "Créditos", "creditos", 2, i155), detail: { text: "no período" } },
        { ...kpi("k_bal_dif_movimento", "Débitos − créditos", "dif_movimento", 2, i155), detail: { text: "deve ser zero" } },
        { ...kpi("k_bal_devedores", "Saldos devedores", "saldos_devedores", 2, i155), detail: { text: "no fim do período" } },
        { ...kpi("k_bal_credores", "Saldos credores", "saldos_credores", 2, i155), detail: { text: "no fim do período" } },
        { ...kpi("k_bal_dif_saldos", "Devedores − credores", "dif_saldos", 2, i155), detail: { text: "deve ser zero" } },
        {
          id: "a_balancete", type: "tree", title: "Balancete", levels: ["grupo_1", "grupo_2", "grupo_3", "conta_sintetica", "conta"],
          columns: [
            { measure: "saldo_inicial", balance: true }, { measure: "debitos" }, { measure: "creditos" }, { measure: "saldo_final", balance: true },
          ],
          open: 1, span: 12, where: i155,
        },
        { id: "l_movimento_mes", type: "line", title: "Débitos e créditos por mês (devem andar juntos)", field: "mes", measures: ["debitos", "creditos"], sort: "field", limit: 400, span: 12, where: i155 },
        { id: "t_contas", type: "table", title: "Contas analíticas", fields: ["natureza", "conta", "conta_referencial"], measures: ["debitos", "creditos", "saldo_inicial", "saldo_final"], limit: 600, span: 12, where: i155 },
      ],
      strip: ["l_movimento_mes", "t_contas"],
    },
    {
      // The balancete and the journal of the same file, account by account: both checks need the entries,
      // which only the main fact (the latest file of each company) keeps.
      id: "razonetes", title: "Razonetes",
      description: "Cada conta em T: débitos à esquerda, créditos à direita, saldo inicial em cima e final embaixo. "
        + "Cada razonete se confere: o saldo final é o inicial mais os débitos menos os créditos (I155), e os débitos e créditos do balancete batem com as partidas do diário (I250). "
        + "Abre nas contas que não fecham, com a diferença; o seletor mostra todas. Do arquivo mais recente de cada empresa, onde estão os lançamentos.",
      visuals: [
        {
          id: "r_razonetes", type: "ledger", title: "Razonetes das contas", field: "conta", detail: "empresa",
          opening: "saldo_inicial", debit: "debitos", credit: "creditos", closing: "saldo_final",
          journal: { debit: "partidas_debito", credit: "partidas_credito" }, limit: 240, span: 12, where: isReg("I155", "I250"),
        },
      ],
    },
    {
      id: "resultado", title: "Resultado do exercício",
      description: "O último exercício da seleção (sem filtro, o mais recente; um clique num ano do gráfico por ano leva a ele): quanto entrou, quanto ficou e para onde foi o resto. "
        + "A cascata vai da receita bruta ao lucro líquido, linha a linha da DRE; ao lado, o mesmo resultado ano a ano, as margens e as contas que mais pesaram. "
        + "Os valores são os da DRE gerencial (contas pela referencial, I051; no mês do encerramento, os saldos antes dele, I355).",
      visuals: [
        { ...kpi("k_ex_ano", "Exercício", "ex_ano", 3, dreRegs), skipFilters: ["mes", "natureza"] },
        { ...kpi("k_ex_receita", "Receita líquida", "ex_receita_liquida", 3, dreRegs), skipFilters: ["mes", "natureza"] },
        { ...kpi("k_ex_lucro", "Lucro líquido", "ex_lucro_liquido", 3, dreRegs), skipFilters: ["mes", "natureza"] },
        { ...kpi("k_ex_margem", "Margem líquida", "ex_margem_liquida", 3, dreRegs), skipFilters: ["mes", "natureza"] },
        {
          id: "w_receita_lucro", type: "waterfall", title: "Da receita ao lucro: para onde vai cada real do exercício", span: 12,
          where: `${dreRegs} AND ${result}`, skipFilters: ["mes", "natureza"],
          items: [
            { measure: "ex_receita_bruta", label: "Receita bruta", total: true },
            { measure: "ex_deducoes", label: "Deduções" },
            { measure: "ex_receita_liquida", label: "Receita líquida", total: true },
            { measure: "ex_custos", label: "Custos" },
            { measure: "ex_lucro_bruto", label: "Lucro bruto", total: true },
            { measure: "ex_despesas_operacionais", label: "Despesas operacionais" },
            { measure: "ex_resultado_operacional", label: "Resultado operacional", total: true },
            { measure: "ex_resultado_financeiro", label: "Resultado financeiro" },
            { measure: "ex_outros", label: "Outras receitas e despesas" },
            { measure: "ex_resultado_antes_ir", label: "Antes do IR e da CSLL", total: true },
            { measure: "ex_ir_csll", label: "IR e CSLL" },
            { measure: "ex_lucro_liquido", label: "Lucro líquido", total: true },
          ],
        },
        {
          id: "sc_resultado_anos", type: "scorecard", title: "O resultado ano a ano: cada linha da DRE e o que ela é da receita", span: 12, field: "ano", limit: 12,
          where: dreRegs, skipFilters: ["ano", "mes", "natureza"],
          items: [
            { measure: "receita_liquida_dre", group: "Receita e lucro", note: "Receita bruta menos deduções.", better: "higher" },
            { measure: "lucro_bruto_dre", group: "Receita e lucro", note: "Receita líquida menos custos.", better: "higher" },
            { measure: "dre_resultado_operacional", group: "Receita e lucro", note: "Lucro bruto menos as despesas da operação.", better: "higher" },
            { measure: "dre_resultado_financeiro", group: "Receita e lucro", note: "Receitas menos despesas financeiras.", better: "higher" },
            { measure: "resultado_dre", label: "Lucro líquido", group: "Receita e lucro", note: "O que ficou depois de tudo, inclusive IR e CSLL.", better: "higher" },
            { measure: "margem_bruta", group: "Margens", note: "Lucro bruto ÷ receita líquida.", better: "higher" },
            { measure: "margem_operacional", group: "Margens", note: "Resultado operacional ÷ receita líquida.", better: "higher" },
            { measure: "margem_liquida", group: "Margens", note: "Lucro líquido ÷ receita líquida.", better: "higher" },
            { measure: "peso_despesas", group: "Eficiência", note: "Quanto da receita as despesas operacionais levam.", better: "lower" },
            { measure: "aliquota_efetiva", group: "Eficiência", note: "IR e CSLL ÷ resultado antes deles.", better: "lower" },
          ],
        },
        {
          id: "b_resultado_anos", type: "bar", title: "Receita líquida e lucro líquido por ano (clique num ano para ver o exercício dele)",
          field: "ano", measures: ["receita_liquida_dre", "resultado_dre"], sort: "field", limit: 40, span: 12, where: dreRegs, skipFilters: ["ano", "mes", "natureza"],
        },
        {
          id: "l_margens_anos", type: "line", title: "Margens por ano: bruta, operacional e líquida",
          field: "ano", measures: ["margem_bruta", "margem_operacional", "margem_liquida"], sort: "field", limit: 40, span: 12, where: dreRegs, skipFilters: ["ano", "mes", "natureza"],
        },
        {
          id: "b_resultado_grupo", type: "bar", title: "O que formou o resultado do exercício, por grupo de contas", field: "grupo_3", measures: ["ex_valor"],
          sort: "measure_desc", horizontal: true, limit: 25, span: 12, where: `${dreRegs} AND ${result}`, skipFilters: ["mes", "natureza"],
        },
        {
          id: "t_resultado_contas", type: "table", title: "Contas de resultado do exercício, da que mais somou à que mais tirou", fields: ["grupo_3", "conta"],
          measures: ["ex_valor"], limit: 400, span: 12, where: `${dreRegs} AND ${result}`, skipFilters: ["mes", "natureza"],
        },
      ],
      strip: ["sc_resultado_anos", "b_resultado_anos", "l_margens_anos", "b_resultado_grupo", "t_resultado_contas"],
    },
    {
      id: "lancamentos", title: "Lançamentos",
      description: "Lançamentos (I200) e suas partidas (I250) do arquivo mais recente de cada empresa: os lançamentos dos outros períodos não ficam guardados no dashboard.",
      visuals: [
        kpi("k_lancamentos", "Lançamentos", "lancamentos", 3, i200), kpi("k_valor_lancado", "Valor lançado", "valor_lancado", 3, i200),
        kpi("k_partidas", "Partidas", "partidas", 3, i250), kpi("k_partidas_debito", "Débitos das partidas", "partidas_debito", 3, i250),
        { id: "l_lancamentos_dia", type: "line", title: "Valor lançado por dia", field: "dia", measures: ["valor_lancado"], sort: "field", limit: 400, span: 8, where: i200 },
        { id: "d_tipo_lancamento", type: "donut", title: "Lançamentos por tipo", field: "tipo_lancamento", measure: "lancamentos", span: 4, where: i200 },
        { id: "t_contas_movimento", type: "table", title: "Contas mais movimentadas", fields: ["conta"], measures: ["partidas", "partidas_debito", "partidas_credito"], limit: 100, span: 12, where: i250 },
      ],
    },
    {
      id: "demonstracoes", title: "Demonstrações contábeis", description: "Balanço patrimonial (J100) e demonstração do resultado (J150), como estão no arquivo.",
      visuals: [
        demo("r_balanco", "J100", "Balanço patrimonial (J100)", ["COD_AGL", "NIVEL_AGL", "IND_GRP_BAL", "DESCR_COD_AGL", "VL_CTA_INI", "IND_DC_CTA_INI", "VL_CTA_FIN", "IND_DC_CTA_FIN"]),
        demo("r_dre", "J150", "Demonstração do resultado (J150)", ["NU_ORDEM", "COD_AGL", "NIVEL_AGL", "DESCR_COD_AGL", "VL_CTA_INI", "IND_DC_CTA_INI", "VL_CTA_FIN", "IND_DC_CTA_FIN", "IND_GRP_DRE"], `${j150} AND ${j150Current}`),
        oldDre,
      ],
    },
  ];
  // Every panel but the entries and the razonetes reads all the periods from the table made for them (the main fact holds one file whole).
  const panelsAllPeriods = panels.map((s) => (s.id === "lancamentos" || s.id === "razonetes"
    ? s
    : { ...s, visuals: s.visuals.map((v) => (v.fact ? v : { ...v, fact: "paineis_todos_periodos" })) }));
  measures.push({ id: "saldo_credor", label: "Saldo", sql: `0 - ${lastSum(i155, fin)}`, format: "currency" });
  measures.push(...dreMeasures);
  /** Records that carry a month of their own follow the month filter; the others always show. */
  const monthly = new Set(["I150", "I155", "I200", "I250", "I300", "I310", "I350", "I355", "C150", "C155"]);
  return build(k, {
    name: "ECD", area: "Contábil",
    description: "Escrituração contábil digital completa: balancete, lançamentos e demonstrações em painéis, e todos os registros do arquivo com todos os campos para consulta.",
    fields, measures, filters: ["ano", "mes", "empresa", "natureza"], panels: panelsAllPeriods, panelGroup: "Painéis",
    skipFilters: (reg) => (monthly.has(reg) ? ["natureza"] : ["mes", "natureza"]),
  });
}

const dir = path.join(process.cwd(), "fiscal-templates");
for (const make of [efdIcms, efdContrib, ecd]) {
  const template = make();
  const parsed = templateSchema.safeParse(template);
  if (!parsed.success) {
    console.error(`${template.id as string}: inválido`);
    for (const issue of parsed.error.issues.slice(0, 15)) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const json = `${JSON.stringify(template)}\n`;
  writeFileSync(path.join(dir, `${template.id as string}.json`), json, "utf8");
  console.log(`${template.id as string}: ${(template.visuals as unknown[]).length} visuais, ${(template.analyses as unknown[]).length} seções, ${Math.round(json.length / 1024)} KB`);
}
