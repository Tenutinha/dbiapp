/**
 * Gera o molde de NF-e (web/fiscal-templates/nfe.json) a partir do layout em src/lib/fiscal/nfe-layout.ts:
 * painéis analíticos no topo e, abaixo, os dados originais — uma listagem por grupo de campos, com as
 * colunas na ordem e com os nomes da extração.
 *
 * Uso (em web/): node --import tsx scripts/fiscal/gerar-molde-nfe.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { NFE_COLUMNS, NFE_FACT, NFE_GROUP_TITLES, nfeColumn, type NfeGroup } from "../../src/lib/fiscal/nfe-layout";
import { templateSchema } from "../../src/lib/templates/schema";

type Json = Record<string, unknown>;

/** Column of the fact by the header of the extraction. */
const c = (header: string): string => `${NFE_FACT}.${nfeColumn(header)}`;
const sum = (header: string): string => `SUM(${c(header)})`;
const nz = (expr: string): string => `COALESCE(${expr}, 0)`;

const CHAVE = c("chNFe_xml");
const DATA = c("EMISSÃO_DATA");
const VPROD = sum("PROD_VPROD");
const TRIBUTOS = ["IMPOSTO_ICMS_VICMS", "IMPOSTO_ICMSST_VICMSST", "IMPOSTO_IPI_vIPI", "IMPOSTO_PIS_VPIS", "IMPOSTO_COFINS_VCOFINS"]
  .map((h) => nz(sum(h))).join(" + ");

/** UF of the issuer: the first two digits of the access key are the IBGE code of the state. */
const UF_CODES: Readonly<Record<string, string>> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN",
  "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC",
  "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};
const UF_EMITENTE = `CASE left(${CHAVE}, 2) ${Object.entries(UF_CODES).map(([code, uf]) => `WHEN '${code}' THEN '${uf}'`).join(" ")} END`;

const fields = [
  { id: "ano", label: "Ano", sql: `CAST(year(${DATA}) AS VARCHAR)` },
  { id: "mes", label: "Mês", sql: `strftime(${DATA}, '%Y-%m')` },
  { id: "emissao", label: "Emissão", sql: `CASE ${c("EMITENTE")} WHEN 'PRÓPRIO' THEN 'Própria' WHEN 'TERCEIRO' THEN 'De terceiros' ELSE ${c("EMITENTE")} END` },
  { id: "modelo", label: "Modelo", sql: c("IDE_MOD") },
  { id: "emitente", label: "Emitente", sql: c("EMIT_NOME") },
  { id: "cnpj_emitente", label: "CNPJ do emitente", sql: c("EMIT_CNPJ") },
  { id: "uf_emitente", label: "UF do emitente", sql: UF_EMITENTE },
  { id: "destinatario", label: "Destinatário", sql: c("DEST_NOME") },
  { id: "cnpj_destinatario", label: "CNPJ do destinatário", sql: c("DEST_CNPJ") },
  { id: "natureza_operacao", label: "Natureza da operação", sql: c("IDE_NATOP") },
  { id: "cfop", label: "CFOP", sql: c("PROD_CFOP") },
  { id: "ncm", label: "NCM", sql: c("PROD_NCM") },
  { id: "capitulo_ncm", label: "Capítulo do NCM", sql: `left(${c("PROD_NCM")}, 2)` },
  { id: "produto", label: "Produto", sql: c("PROD_XPROD") },
  { id: "cst_icms", label: "CST ICMS", sql: c("IMPOSTO_ICMS_CST") },
  { id: "cst_pis", label: "CST PIS", sql: c("IMPOSTO_PIS_CST") },
  { id: "cst_cofins", label: "CST COFINS", sql: c("IMPOSTO_COFINS_CST") },
  { id: "monofasico", label: "NCM monofásico", sql: `CASE ${c("NCM_MONOFÁSICO")} WHEN 'S' THEN 'Sim' WHEN 'N' THEN 'Não' END` },
  { id: "no_sped_contribuicoes", label: "Consta na EFD Contribuições", sql: `CASE ${c("CONTEM_SPED_PISCOFINS")} WHEN 'S' THEN 'Sim' WHEN 'N' THEN 'Não' END` },
  { id: "no_sped_icms", label: "Consta na EFD ICMS/IPI", sql: `CASE ${c("CONTEM_SPED_ICMS")} WHEN 'S' THEN 'Sim' WHEN 'N' THEN 'Não' END` },
  { id: "nota", label: "Nota", sql: c("nNF") },
  { id: "chave", label: "Chave de acesso", sql: CHAVE },
];

const measures = [
  { id: "valor_produtos", label: "Valor dos produtos", sql: VPROD, format: "currency" },
  { id: "descontos", label: "Descontos", sql: sum("PROD_VDESC"), format: "currency" },
  { id: "valor_liquido", label: "Valor líquido", sql: `${VPROD} - ${nz(sum("PROD_VDESC"))}`, format: "currency" },
  { id: "base_icms", label: "Base de cálculo do ICMS", sql: sum("IMPOSTO_ICMS_VBC"), format: "currency" },
  { id: "icms", label: "ICMS", sql: sum("IMPOSTO_ICMS_VICMS"), format: "currency" },
  { id: "icms_st", label: "ICMS-ST", sql: sum("IMPOSTO_ICMSST_VICMSST"), format: "currency" },
  { id: "ipi", label: "IPI", sql: sum("IMPOSTO_IPI_vIPI"), format: "currency" },
  { id: "pis", label: "PIS", sql: sum("IMPOSTO_PIS_VPIS"), format: "currency" },
  { id: "cofins", label: "COFINS", sql: sum("IMPOSTO_COFINS_VCOFINS"), format: "currency" },
  { id: "tributos", label: "Tributos destacados", sql: TRIBUTOS, format: "currency" },
  { id: "carga_tributaria", label: "Carga tributária destacada", sql: `(${TRIBUTOS}) / NULLIF(${VPROD}, 0)`, format: "percent" },
  { id: "notas", label: "Notas", sql: `COUNT(DISTINCT ${CHAVE})`, format: "integer" },
  { id: "itens", label: "Itens", sql: "COUNT(*)", format: "integer" },
  { id: "valor_medio_nota", label: "Valor médio por nota", sql: `${VPROD} / NULLIF(COUNT(DISTINCT ${CHAVE}), 0)`, format: "currency" },
  { id: "quantidade", label: "Quantidade", sql: sum("PROD_QCOM"), format: "number" },
];

const kpi = (id: string, title: string, measure: string, span: number): Json => ({ id, type: "kpi", title, measure, span });

/** Fields that identify the line, put first in the listings that do not already bring them. */
const IDENTITY = ["chNFe_xml", "PROD_ITEM"];

function rawListing(group: NfeGroup): Json {
  const own = NFE_COLUMNS.filter((col) => col.group === group);
  const lead = IDENTITY.filter((h) => !own.some((col) => col.header === h));
  return {
    id: `r_${group}`,
    type: "rows",
    title: NFE_GROUP_TITLES[group],
    span: 12,
    orderBy: `${DATA}, ${CHAVE}, ${c("PROD_ITEM")}`,
    limit: 20,
    expand: { filter: "mes", limit: 1000 },
    columns: [
      ...lead.map((h) => ({ label: h, sql: c(h) })),
      ...own.map((col) => ({ label: col.header, sql: `${NFE_FACT}.${col.name}` })),
    ],
  };
}

interface Section { id: string; title: string; description: string; visuals: Json[] }

const panels: Section[] = [
  {
    id: "visao_geral", title: "Visão geral",
    description: "Valores somados item a item. Os tributos são os destacados nas notas (ICMS, ICMS-ST, IPI, PIS e COFINS).",
    visuals: [
      kpi("k_valor", "Valor dos produtos", "valor_produtos", 3), kpi("k_notas", "Notas", "notas", 3),
      kpi("k_medio", "Valor médio por nota", "valor_medio_nota", 3), kpi("k_tributos", "Tributos destacados", "tributos", 3),
      kpi("k_icms", "ICMS", "icms", 2), kpi("k_icms_st", "ICMS-ST", "icms_st", 2), kpi("k_ipi", "IPI", "ipi", 2),
      kpi("k_pis", "PIS", "pis", 2), kpi("k_cofins", "COFINS", "cofins", 2), kpi("k_carga", "Carga destacada", "carga_tributaria", 2),
      { id: "l_mes", type: "line", title: "Valor e tributos por mês", field: "mes", measures: ["valor_produtos", "tributos"], sort: "field", span: 8 },
      { id: "d_emissao", type: "donut", title: "Valor por emissão própria e de terceiros", field: "emissao", measure: "valor_produtos", span: 4 },
    ],
  },
  {
    id: "produtos", title: "CFOP, NCM e produtos", description: "",
    visuals: [
      { id: "b_cfop", type: "bar", title: "Valor por CFOP", field: "cfop", measures: ["valor_produtos"], sort: "measure_desc", horizontal: true, limit: 15, span: 6 },
      { id: "b_ncm", type: "bar", title: "Valor por capítulo do NCM", field: "capitulo_ncm", measures: ["valor_produtos"], sort: "measure_desc", horizontal: true, limit: 15, span: 6 },
      { id: "t_produtos", type: "table", title: "Produtos", fields: ["produto", "ncm"], measures: ["quantidade", "valor_produtos", "icms", "ipi", "pis", "cofins"], limit: 200, span: 12 },
    ],
  },
  {
    id: "tributacao", title: "Tributação", description: "Situação tributária informada em cada item da nota.",
    visuals: [
      { id: "t_cst_icms", type: "table", title: "CST de ICMS", fields: ["cst_icms"], measures: ["valor_produtos", "base_icms", "icms", "icms_st"], limit: 50, span: 6 },
      { id: "t_cst_pis_cofins", type: "table", title: "CST de PIS e COFINS", fields: ["cst_pis", "cst_cofins"], measures: ["valor_produtos", "pis", "cofins"], limit: 50, span: 6 },
      { id: "d_monofasico", type: "donut", title: "Valor por NCM monofásico", field: "monofasico", measure: "valor_produtos", span: 4, hideEmpty: true },
      { id: "d_sped_contribuicoes", type: "donut", title: "Notas que constam na EFD Contribuições", field: "no_sped_contribuicoes", measure: "notas", span: 4, hideEmpty: true },
      { id: "d_sped_icms", type: "donut", title: "Notas que constam na EFD ICMS/IPI", field: "no_sped_icms", measure: "notas", span: 4, hideEmpty: true },
    ],
  },
  {
    id: "participantes", title: "Emitentes e destinatários", description: "A UF do emitente vem dos dois primeiros dígitos da chave de acesso.",
    visuals: [
      { id: "t_emitentes", type: "table", title: "Emitentes", fields: ["emitente", "cnpj_emitente", "uf_emitente"], measures: ["notas", "valor_produtos", "tributos"], limit: 100, span: 7 },
      { id: "t_destinatarios", type: "table", title: "Destinatários", fields: ["destinatario", "cnpj_destinatario"], measures: ["notas", "valor_produtos", "tributos"], limit: 100, span: 5 },
      { id: "b_uf_emitente", type: "bar", title: "Valor por UF do emitente", field: "uf_emitente", measures: ["valor_produtos"], sort: "measure_desc", limit: 27, span: 12 },
    ],
  },
  {
    id: "notas", title: "Notas", description: "",
    visuals: [
      { id: "t_notas", type: "table", title: "Notas", fields: ["nota", "emissao", "emitente", "destinatario", "natureza_operacao"], measures: ["valor_produtos", "descontos", "icms", "icms_st", "ipi"], limit: 500, span: 12 },
    ],
  },
];

const GROUPS = Object.keys(NFE_GROUP_TITLES) as NfeGroup[];
const raw: Section = {
  id: "dados_originais", title: "Campos das notas",
  description: "Uma linha por item de nota, com os campos na ordem e com os nomes da extração. Cada listagem mostra 20 linhas; ao filtrar um mês, até 1.000.",
  visuals: GROUPS.map(rawListing),
};

const sections = [...panels, raw];
const template: Json = {
  id: "nfe",
  version: 1,
  name: "NF-e",
  area: "Fiscal",
  origin: "web",
  description: "Notas fiscais eletrônicas item a item: valores, impostos destacados (ICMS, ICMS-ST, IPI, PIS, COFINS), CFOP, NCM, produtos, emitentes e destinatários por mês, e todos os campos das notas para consulta.",
  tables: [{
    name: NFE_FACT,
    kind: "fact",
    description: "Uma linha por item (det) de cada NF-e, com os dados da nota repetidos, no layout da extração de campos do XML.",
    sortBy: nfeColumn("EMISSÃO_DATA"),
    columns: NFE_COLUMNS.map((col) => ({
      name: col.name,
      type: col.type,
      ...(col.required ? {} : { required: false }),
      description: col.description ? `${col.header}: ${col.description}` : col.header,
    })),
  }],
  relationships: [],
  fields,
  measures,
  filters: ["ano", "mes", "emissao", "uf_emitente", "destinatario", "cfop", "capitulo_ncm", "cst_icms"],
  visuals: sections.flatMap((s) => s.visuals),
  analyses: sections.map((s) => ({ id: s.id, title: s.title, description: s.description, visuals: s.visuals.map((v) => v.id as string) })),
  summary: [
    { title: "Painéis", analyses: panels.map((s) => s.id) },
    { title: "Dados originais", analyses: [raw.id] },
  ],
};

const parsed = templateSchema.safeParse(template);
if (!parsed.success) {
  console.error("nfe: inválido");
  for (const issue of parsed.error.issues.slice(0, 15)) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const json = `${JSON.stringify(template, null, 2)}\n`;
writeFileSync(path.join(process.cwd(), "fiscal-templates", "nfe.json"), json, "utf8");
console.log(`nfe: ${NFE_COLUMNS.length} colunas, ${(template.visuals as unknown[]).length} visuais, ${sections.length} seções, ${Math.round(json.length / 1024)} KB`);
