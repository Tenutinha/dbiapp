/**
 * Gera os moldes dos três SPEDs (web/fiscal-templates/{efd-icms-ipi,efd-contribuicoes,ecd}.json) a partir
 * dos layouts em src/lib/fiscal/layouts: painéis analíticos no topo e, abaixo, os dados originais — uma
 * seção por bloco, uma listagem por registro, uma coluna por campo do layout.
 *
 * Uso (em web/): node --import tsx scripts/fiscal/gerar-moldes.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { factColumns, fieldColumn, FACT_BASE, SPED_KINDS, type SpedKind } from "../../src/lib/fiscal/sped-kinds";
import { templateSchema } from "../../src/lib/templates/schema";

type Json = Record<string, unknown>;
interface Field { id: string; label: string; sql: string }
interface Measure { id: string; label: string; sql: string; format: "currency" | "number" | "integer" | "percent" | "text" }
interface Section { id: string; title: string; description: string; visuals: Json[] }

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

/** "C100 - Nota fiscal …" for every record of the layout, as one CASE (used as a field and a filter). */
function registroNome(kind: SpedKind): string {
  const whens = Object.entries(kind.layout).map(([code, r]) => `WHEN '${code}' THEN '${code} - ${literal(r.d).slice(0, 70)}'`);
  return `CASE ${F}.registro ${whens.join(" ")} ELSE ${F}.registro END`;
}

/** The original data: one section per block, one listing per record, one column per field. */
function rawSections(kind: SpedKind, opts: { skipFilters?: (reg: string) => string[] | undefined }): Section[] {
  const blocks = BLOCKS[kind.templateId];
  const rootBlocks = new Set(Object.keys(kind.roots).map((r) => r[0]));
  const multiEstab = kind.establishmentRecords.size > 0;
  const sections: Section[] = [{
    id: "registros_do_arquivo",
    title: "Registros do arquivo",
    description: "Quantas linhas cada registro tem nos arquivos carregados. Abaixo, cada bloco traz os registros com todos os campos, como vieram no txt.",
    visuals: [{
      id: "t_registros", type: "table", title: "Linhas por registro", fields: ["bloco", "registro_nome"], measures: ["linhas"], limit: 400, span: 12,
    }],
  }];
  const known = Object.keys(kind.layout);
  for (const [block, name] of Object.entries(blocks)) {
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
    sections.push({ id: `bloco_${block.toLowerCase()}`, title: `Bloco ${block} · ${name}`, description: "", visuals });
  }
  sections.push({
    id: "outros_registros",
    title: "Outros registros",
    description: "Registros que os arquivos trazem e que ainda não estão no layout cadastrado: os campos aparecem pela posição.",
    visuals: [{
      id: "r_outros", type: "rows", title: "Registros fora do layout", span: 12, hideEmpty: true,
      where: `${F}.registro NOT IN (${known.map((r) => `'${r}'`).join(", ")})`,
      orderBy: `${F}.arquivo, ${F}.linha`, limit: 20, expand: { filter: "registro_nome", limit: 1000 },
      columns: [
        { label: "Arquivo", sql: `${F}.arquivo` }, { label: "Linha", sql: `${F}.linha` }, { label: "Registro", sql: `${F}.registro` },
        ...Array.from({ length: kind.width }, (_, i) => ({ label: `Campo ${i + 2}`, sql: `${F}.${fieldColumn(i + 1)}` })),
      ],
    }],
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
    { name: "grupo_3", type: "text", required: false }, { name: "cod_cta_ref", type: "text", required: false }] },
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
}

function build(kind: SpedKind, p: Parts): Json {
  const raw = rawSections(kind, { skipFilters: p.skipFilters });
  const sections = [...p.panels, ...raw];
  return {
    id: kind.templateId,
    version: 1,
    name: p.name,
    area: p.area,
    origin: "web",
    description: p.description,
    tables: [factTable(kind), ...kind.dimensions.map((d) => DIM_TABLES[d])],
    relationships: kind.dimensions.map((d) => ({ from: { table: F, column: DIM_LINK[d] }, to: { table: d, column: DIM_LINK[d] } })),
    fields: [
      ...p.fields,
      { id: "bloco", label: "Bloco", sql: `${F}.bloco` },
      { id: "registro_nome", label: "Registro", sql: registroNome(kind) },
    ],
    measures: [...p.measures, { id: "linhas", label: "Linhas", sql: "COUNT(*)", format: "integer" }],
    filters: [...p.filters, "bloco", "registro_nome"],
    filterDefaults: p.filterDefaults ?? {},
    visuals: sections.flatMap((s) => s.visuals),
    analyses: sections.map((s) => ({ id: s.id, title: s.title, description: s.description, visuals: s.visuals.map((v) => v.id as string) })),
    summary: [
      { title: p.panelGroup, analyses: p.panels.map((s) => s.id) },
      { title: "Dados originais", analyses: raw.map((s) => s.id) },
    ],
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
      id: "documentos", title: "Notas fiscais e participantes", description: "A partir do registro C100 (notas canceladas, denegadas e inutilizadas ficam fora dos valores).",
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
      id: "itens", title: "Itens e inventário", description: "Itens das notas (C170) e inventário (H010).",
      visuals: [
        { id: "t_itens", type: "table", title: "Itens das notas", fields: ["item", "ncm"], measures: ["valor_itens", "valor_itens_entrada", "valor_itens_saida", "quantidade_itens"], limit: 200, span: 8, where: c170 },
        { id: "b_ncm", type: "bar", title: "Valor dos itens por NCM", field: "ncm", measures: ["valor_itens"], sort: "measure_desc", horizontal: true, limit: 15, span: 4, where: c170 },
        { ...kpi("k_inventario", "Valor do inventário (H010)", "valor_inventario", 6, h010), hideEmpty: true },
        { ...kpi("k_itens_inventario", "Itens em inventário", "itens_inventario", 6, h010), hideEmpty: true },
        { id: "t_inventario", type: "table", title: "Inventário por item", fields: ["item", "ncm"], measures: ["valor_inventario", "quantidade_inventario"], limit: 200, span: 12, where: h010, hideEmpty: true },
      ],
    },
  ];
  return build(k, {
    name: "EFD ICMS/IPI", area: "Fiscal",
    description: "Escrituração fiscal de ICMS e IPI completa: operações, apuração, notas, itens e inventário em painéis, e todos os registros do arquivo com todos os campos para consulta.",
    fields, measures, filters: ["ano", "mes", "estabelecimento", "operacao"], panels, panelGroup: "Painéis",
  });
}

// ------------------------------------------------------------------ EFD Contribuições

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
  ];
  const mx = isReg("M200", "M600");
  const panels: Section[] = [
    {
      id: "visao_geral", title: "Visão geral",
      description: "Receitas, débitos e créditos somados item a item dos blocos A, C, D e F. Os valores a recolher vêm da apuração (M200 e M600).",
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
  ];
  return build(k, {
    name: "EFD Contribuições", area: "Fiscal",
    description: "Escrituração de PIS e COFINS completa: receitas, débitos, créditos e apuração em painéis, e todos os registros do arquivo com todos os campos para consulta.",
    fields, measures, filters: ["ano", "mes", "estabelecimento"], panels, panelGroup: "Painéis",
  });
}

// ------------------------------------------------------------------ ECD

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
  const deb = num(col(k, "I155", "VL_DEB"));
  const cre = num(col(k, "I155", "VL_CRED"));
  const nat = (code: string): string => `${i155} AND plano_contas.natureza = '${code}'`;
  const vlDc = num(col(k, "I250", "VL_DC"));
  const dc = col(k, "I250", "IND_DC");

  const fields: Field[] = [
    { id: "mes", label: "Mês", sql: `strftime(${F}.periodo, '%Y-%m')` },
    { id: "empresa", label: "Empresa", sql: "empresas.nome" },
    { id: "natureza", label: "Natureza", sql: "CASE plano_contas.natureza WHEN '01' THEN '1 - Ativo' WHEN '02' THEN '2 - Passivo' WHEN '03' THEN '3 - Patrimônio líquido' WHEN '04' THEN '4 - Resultado' WHEN '05' THEN '5 - Compensação' WHEN '09' THEN '9 - Outras' END" },
    { id: "grupo_1", label: "Grupo (nível 1)", sql: "plano_contas.grupo_1" },
    { id: "grupo_2", label: "Grupo (nível 2)", sql: "plano_contas.grupo_2" },
    { id: "grupo_3", label: "Grupo (nível 3)", sql: "plano_contas.grupo_3" },
    { id: "conta", label: "Conta", sql: "concat(plano_contas.cod_cta, ' - ', plano_contas.nome)" },
    { id: "conta_referencial", label: "Conta referencial", sql: "plano_contas.cod_cta_ref" },
    { id: "dia", label: "Dia", sql: `strftime(${F}.dt_doc, '%Y-%m-%d')` },
    { id: "tipo_lancamento", label: "Tipo de lançamento", sql: `CASE ${col(k, "I200", "IND_LCTO")} WHEN 'N' THEN 'N - Normal' WHEN 'E' THEN 'E - Encerramento' WHEN 'X' THEN 'X - Extemporâneo' ELSE ${col(k, "I200", "IND_LCTO")} END` },
  ];
  const measures: Measure[] = [
    { id: "saldo_inicial", label: "Saldo inicial", sql: sumWhen(i155, ini), format: "currency" },
    { id: "debitos", label: "Débitos", sql: sumWhen(i155, deb), format: "currency" },
    { id: "creditos", label: "Créditos", sql: sumWhen(i155, cre), format: "currency" },
    { id: "saldo_final", label: "Saldo final", sql: sumWhen(i155, fin), format: "currency" },
    { id: "ativo", label: "Ativo", sql: sumWhen(nat("01"), fin), format: "currency" },
    { id: "passivo", label: "Passivo", sql: `-${sumWhen(nat("02"), fin)}`, format: "currency" },
    { id: "patrimonio_liquido", label: "Patrimônio líquido", sql: `-${sumWhen(nat("03"), fin)}`, format: "currency" },
    { id: "resultado_acumulado", label: "Resultado acumulado", sql: `-${sumWhen(nat("04"), fin)}`, format: "currency" },
    { id: "resultado_mes", label: "Resultado do mês", sql: sumWhen(nat("04"), `${cre} - ${deb}`), format: "currency" },
    { id: "contas_movimentadas", label: "Contas movimentadas", sql: `COUNT(DISTINCT CASE WHEN ${i155} AND (${deb} <> 0 OR ${cre} <> 0) THEN ${F}.id_cta END)`, format: "integer" },
    { id: "resultado_antes_encerramento", label: "Resultado antes do encerramento", sql: `-${sumWhen(i355, signed("I355", "VL_CTA", "IND_DC"))}`, format: "currency" },
    { id: "receitas_antes_encerramento", label: "Contas credoras (receitas)", sql: sumWhen(`${i355} AND ${col(k, "I355", "IND_DC")} = 'C'`, num(col(k, "I355", "VL_CTA"))), format: "currency" },
    { id: "despesas_antes_encerramento", label: "Contas devedoras (custos e despesas)", sql: sumWhen(`${i355} AND ${col(k, "I355", "IND_DC")} = 'D'`, num(col(k, "I355", "VL_CTA"))), format: "currency" },
    { id: "lancamentos", label: "Lançamentos", sql: countWhen(i200), format: "integer" },
    { id: "valor_lancado", label: "Valor lançado", sql: sumWhen(i200, num(col(k, "I200", "VL_LCTO"))), format: "currency" },
    { id: "partidas", label: "Partidas", sql: countWhen(i250), format: "integer" },
    { id: "partidas_debito", label: "Débitos das partidas", sql: sumWhen(`${i250} AND ${dc} = 'D'`, vlDc), format: "currency" },
    { id: "partidas_credito", label: "Créditos das partidas", sql: sumWhen(`${i250} AND ${dc} = 'C'`, vlDc), format: "currency" },
  ];
  const demo = (id: string, reg: string, title: string, names: string[]): Json => ({
    id, type: "rows", title, span: 12, where: isReg(reg), hideEmpty: true, skipFilters: ["mes", "natureza"],
    orderBy: `${F}.arquivo, ${F}.linha`, limit: 500,
    columns: names.map((n) => ({ label: n, sql: col(k, reg, n) })),
  });
  const panels: Section[] = [
    {
      id: "visao_geral", title: "Visão geral",
      description: "Posição do mês escolhido no filtro (abre no mais recente), a partir dos saldos periódicos (I155). Saldos credores de passivo, patrimônio líquido e resultado aparecem positivos.",
      visuals: [
        kpi("k_ativo", "Ativo", "ativo", 3, i155), kpi("k_passivo", "Passivo", "passivo", 3, i155),
        kpi("k_pl", "Patrimônio líquido", "patrimonio_liquido", 3, i155), kpi("k_resultado", "Resultado acumulado", "resultado_acumulado", 3, i155),
        kpi("k_resultado_mes", "Resultado do mês", "resultado_mes", 3, i155), kpi("k_debitos", "Débitos do mês", "debitos", 3, i155),
        kpi("k_creditos", "Créditos do mês", "creditos", 3, i155), kpi("k_contas", "Contas movimentadas", "contas_movimentadas", 3, i155),
        { id: "d_ativo", type: "donut", title: "Composição do ativo", field: "grupo_2", measure: "ativo", span: 6, where: nat("01") },
        { id: "d_passivo", type: "donut", title: "Composição do passivo e do patrimônio líquido", field: "grupo_2", measure: "saldo_credor", span: 6, where: `${i155} AND plano_contas.natureza IN ('02', '03')` },
      ],
    },
    {
      id: "balancete", title: "Balancete", description: "",
      visuals: [
        { id: "t_balancete", type: "table", title: "Balancete por grupo", fields: ["natureza", "grupo_1", "grupo_2", "grupo_3"], measures: ["debitos", "creditos", "saldo_inicial", "saldo_final"], limit: 400, span: 12, where: i155 },
        { id: "b_resultado", type: "bar", title: "Resultado acumulado por grupo (saldos periódicos)", field: "grupo_3", measures: ["resultado_acumulado"], sort: "measure_desc", horizontal: true, limit: 25, span: 12, where: nat("04") },
        { id: "t_contas", type: "table", title: "Contas analíticas", fields: ["natureza", "conta", "conta_referencial"], measures: ["debitos", "creditos", "saldo_inicial", "saldo_final"], limit: 600, span: 12, where: i155 },
      ],
    },
    {
      id: "resultado", title: "Resultado do exercício",
      description: "Saldos das contas de resultado antes do encerramento (I355). No mês do encerramento os saldos periódicos dessas contas já estão zerados; aqui eles aparecem como estavam.",
      visuals: [
        { ...kpi("k_resultado_exercicio", "Resultado antes do encerramento", "resultado_antes_encerramento", 4, i355), hideEmpty: true },
        { ...kpi("k_receitas_exercicio", "Contas credoras (receitas)", "receitas_antes_encerramento", 4, i355), hideEmpty: true },
        { ...kpi("k_despesas_exercicio", "Contas devedoras (custos e despesas)", "despesas_antes_encerramento", 4, i355), hideEmpty: true },
        { id: "b_resultado_grupo", type: "bar", title: "Resultado antes do encerramento por grupo", field: "grupo_3", measures: ["resultado_antes_encerramento"], sort: "measure_desc", horizontal: true, limit: 25, span: 12, where: i355, hideEmpty: true },
        { id: "t_resultado_contas", type: "table", title: "Contas de resultado antes do encerramento", fields: ["grupo_3", "conta"], measures: ["resultado_antes_encerramento"], limit: 400, span: 12, where: i355, hideEmpty: true },
      ],
    },
    {
      id: "lancamentos", title: "Lançamentos", description: "Lançamentos (I200) e suas partidas (I250) no mês escolhido.",
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
        demo("r_dre", "J150", "Demonstração do resultado (J150)", ["NU_ORDEM", "COD_AGL", "NIVEL_AGL", "DESCR_COD_AGL", "VL_CTA_INI", "IND_DC_CTA_INI", "VL_CTA_FIN", "IND_DC_CTA_FIN", "IND_GRP_DRE"]),
      ],
    },
  ];
  measures.push({ id: "saldo_credor", label: "Saldo", sql: `-${sumWhen(i155, fin)}`, format: "currency" });
  /** Records that carry a month of their own follow the month filter; the others always show. */
  const monthly = new Set(["I150", "I155", "I200", "I250", "I300", "I310", "I350", "I355", "C150", "C155"]);
  return build(k, {
    name: "ECD", area: "Contábil",
    description: "Escrituração contábil digital completa: balancete, lançamentos e demonstrações em painéis, e todos os registros do arquivo com todos os campos para consulta.",
    fields, measures, filters: ["mes", "empresa", "natureza"], filterDefaults: { mes: "mais recente" }, panels, panelGroup: "Painéis",
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
