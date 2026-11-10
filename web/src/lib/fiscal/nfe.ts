/**
 * NF-e XML (one document per file: <nfeProc> or a bare <NFe>) → rows of the "nfe" template.
 *
 * Fact `nfe_itens`: one row per <det>, with the header (ide, emit, dest) repeated, in the layout of the
 * NF-e field extraction (nfe-layout.ts). Fields that only the extraction knows (which side the company
 * is on, the NCM tables, the cross-check with the SPED) stay empty.
 * Events (cancellation, CC-e) and documents with a rejection status are refused.
 */
import { NFE_COLUMNS } from "./nfe-layout";
import { FiscalFileError, type Cell, type Row } from "./sped";
import { childrenNamed, find, parseXml, textOf, type XmlNode } from "./xml";

export interface NfeTables {
  nfe_itens: Row[];
}

export interface NfeIdentity {
  chave: string;
  cnpjEmit: string;
  /** First day of the month of issue (YYYY-MM-DD). */
  periodo: string;
}

/** Statuses of an authorized NF-e (100 authorized, 150 authorized late). */
const AUTHORIZED = new Set(["100", "150"]);

const decodeXml = (bytes: Uint8Array): string => {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 200));
  const enc = /encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  return new TextDecoder(enc.includes("8859") || enc.includes("latin") ? "latin1" : "utf-8").decode(bytes);
};

function infNFeOf(root: XmlNode): XmlNode {
  if (find(root, "procEventoNFe") || find(root, "evento")) {
    throw new FiscalFileError("Este XML é um evento (cancelamento, carta de correção…), não uma NF-e.");
  }
  const inf = find(root, "infNFe");
  if (!inf) throw new FiscalFileError("Este XML não parece uma NF-e (sem infNFe).");
  const status = textOf(find(root, "protNFe"), "cStat");
  if (status !== null && !AUTHORIZED.has(status)) {
    throw new FiscalFileError(`NF-e não autorizada (status ${status}).`);
  }
  return inf;
}

function chaveOf(inf: XmlNode, root: XmlNode): string {
  const fromId = (inf.attrs.Id ?? "").replace(/^NFe/, "");
  const chave = /^\d{44}$/.test(fromId) ? fromId : textOf(find(root, "protNFe"), "chNFe");
  if (!chave || !/^\d{44}$/.test(chave)) throw new FiscalFileError("NF-e sem chave de acesso válida.");
  return chave;
}

const day = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

function issueDate(ide: XmlNode | undefined): string {
  const d = day(textOf(ide, "dhEmi")) ?? day(textOf(ide, "dEmi"));
  if (!d) throw new FiscalFileError("NF-e sem data de emissão.");
  return d;
}

export function identifyNfe(bytes: Uint8Array): NfeIdentity {
  const root = parseXml(decodeXml(bytes));
  const inf = infNFeOf(root);
  const cnpjEmit = textOf(find(inf, "emit"), "CNPJ") ?? textOf(find(inf, "emit"), "CPF");
  if (!cnpjEmit) throw new FiscalFileError("NF-e sem CNPJ do emitente.");
  return { chave: chaveOf(inf, root), cnpjEmit, periodo: `${issueDate(find(inf, "ide")).slice(0, 7)}-01` };
}


const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

/** Date, year, month (abbreviated), day and hour of a dhEmi/dhSaiEnt (or the date-only dEmi/dSaiEnt). */
function moment(value: string | null): { data: Cell; ano: Cell; mes: Cell; dia: Cell; hora: Cell } {
  const d = day(value);
  if (!d || !value) return { data: null, ano: null, mes: null, dia: null, hora: null };
  return {
    data: d,
    ano: d.slice(0, 4),
    mes: MONTHS[Number(d.slice(5, 7)) - 1] ?? null,
    dia: String(Number(d.slice(8, 10))),
    hora: /T\d{2}:\d{2}/.test(value) ? value.slice(11, 16) : null,
  };
}

/** Fields of the header, the same in every item of the note, by the extraction's header. */
function headerFields(root: XmlNode, inf: XmlNode, chave: string, cnpjEmit: string): Record<string, Cell> {
  const ide = find(inf, "ide");
  const emit = find(inf, "emit");
  const dest = find(inf, "dest");
  const infAdic = find(inf, "infAdic");
  const supl = find(root, "infNFeSupl");
  const emissao = moment(textOf(ide, "dhEmi") ?? textOf(ide, "dEmi"));
  const saida = moment(textOf(ide, "dhSaiEnt") ?? textOf(ide, "dSaiEnt"));
  const dtEmissao = issueDate(ide);
  return {
    XML_versão: inf.attrs.versao ?? null,
    NFE_CODIGO: textOf(ide, "mod"),
    "Chave de Acesso2": inf.attrs.Id ?? null,
    chNFe_xml: chave,
    nNF: textOf(ide, "nNF"),
    EMIT_CNPJ: cnpjEmit,
    EMIT_NOME: textOf(emit, "xNome"),
    EMIT_NOME_FANTASIA: textOf(emit, "xFant"),
    EMIT_IE: textOf(emit, "IE"),
    DEST_CNPJ: dest ? (textOf(dest, "CNPJ") ?? textOf(dest, "CPF") ?? textOf(dest, "idEstrangeiro")) : null,
    DEST_NOME: textOf(dest, "xNome"),
    DEST_IE: textOf(dest, "IE"),
    IDE_NNF: textOf(ide, "nNF"),
    IDE_NATOP: textOf(ide, "natOp"),
    IDE_MOD: textOf(ide, "mod"),
    COBR_VLIQ: textOf(find(inf, "cobr"), "vLiq"),
    INFADIC_FISCO: textOf(infAdic, "infAdFisco"),
    INFADIC_CPL: textOf(infAdic, "infCpl"),
    TOTAL_VPROD: textOf(find(find(inf, "total"), "ICMSTot"), "vProd"),
    INFNFESUPL_QRCODE: textOf(supl, "qrCode"),
    INFNFESUPL_URLCHAVE: textOf(supl, "urlChave"),
    chNFe: textOf(find(root, "protNFe"), "chNFe") ?? chave,
    EMISSÃO_DATA: dtEmissao,
    EMISSÃO_ANO: emissao.ano,
    EMISSÃO_MÊS: emissao.mes,
    EMISSÃO_DIA: emissao.dia,
    EMISSÃO_HORA: emissao.hora,
    EMISSÃO_DATA_SAI: saida.data,
    EMISSÃO_ANO_SAI: saida.ano,
    EMISSÃO_MÊS_SAI: saida.mes,
    EMISSÃO_DIA_SAI: saida.dia,
    EMISSÃO_HORA_SAI: saida.hora,
    ARQUIVO_COMPETENCIA: dtEmissao.slice(0, 7).replace("-", ""),
  };
}

/** Fields of one item (prod and imposto), by the extraction's header. */
function itemFields(det: XmlNode, index: number): Record<string, Cell> {
  const prod = find(det, "prod");
  const imposto = find(det, "imposto");
  const icms = find(imposto, "ICMS");
  const pis = find(imposto, "PIS");
  const cofins = find(imposto, "COFINS");
  const ipi = find(imposto, "IPI");
  const comb = find(prod, "comb");
  return {
    "Valor Unitario": textOf(prod, "vUnCom"),
    infAdProd: textOf(det, "infAdProd"),
    PROD_CPROD: textOf(prod, "cProd"),
    PROD_cEAN: textOf(prod, "cEAN"),
    PROD_XPROD: textOf(prod, "xProd"),
    PROD_NCM: textOf(prod, "NCM"),
    PROD_CEST: textOf(prod, "CEST"),
    PROD_indEscala: textOf(prod, "indEscala"),
    PROD_CFOP: textOf(prod, "CFOP"),
    PROD_UCOM: textOf(prod, "uCom"),
    PROD_QCOM: textOf(prod, "qCom"),
    PROD_VUNCOM: textOf(prod, "vUnCom"),
    PROD_VPROD: textOf(prod, "vProd") ?? "0",
    PROD_cEANTrib: textOf(prod, "cEANTrib"),
    PROD_uTrib: textOf(prod, "uTrib"),
    PROD_qTrib: textOf(prod, "qTrib"),
    PROD_vUnTrib: textOf(prod, "vUnTrib"),
    PROD_indTot: textOf(prod, "indTot"),
    PROD_VDESC: textOf(prod, "vDesc"),
    PROD_VICMS: textOf(icms, "vICMS"),
    PROD_ITEM: det.attrs.nItem ?? String(index + 1),
    PROD_CPRODANP: textOf(comb, "cProdANP"),
    PROD_CDESCANP: textOf(comb, "descANP"),
    IMPOSTO_ICMS_adRemICMSRet: textOf(icms, "adRemICMSRet"),
    IMPOSTO_ICMS_orig: textOf(icms, "orig"),
    IMPOSTO_ICMS_CST: textOf(icms, "CST") ?? textOf(icms, "CSOSN"),
    IMPOSTO_ICMS_VBCSTRET: textOf(icms, "vBCSTRet"),
    IMPOSTO_ICMS_pST: textOf(icms, "pST"),
    IMPOSTO_ICMS_SUBSTITUTO: textOf(icms, "vICMSSubstituto"),
    IMPOSTO_ICMS_vICMSSTRet: textOf(icms, "vICMSSTRet"),
    IMPOSTO_ICMS_pRedBCEfet: textOf(icms, "pRedBCEfet"),
    IMPOSTO_ICMS_vBCEfet: textOf(icms, "vBCEfet"),
    IMPOSTO_ICMS_pICMSEfet: textOf(icms, "pICMSEfet"),
    IMPOSTO_ICMS_vICMSEfet: textOf(icms, "vICMSEfet"),
    IMPOSTO_ICMS_VICMS: textOf(icms, "vICMS"),
    IMPOSTO_ICMS_VBC: textOf(icms, "vBC"),
    IMPOSTO_ICMS_PICMS: textOf(icms, "pICMS"),
    IMPOSTO_ICMS_modBC: textOf(icms, "modBC"),
    IMPOSTO_ICMS_pMVAST: textOf(icms, "pMVAST"),
    IMPOSTO_ICMSST_VRET: textOf(icms, "vICMSSTRet"),
    IMPOSTO_ICMSST_VBCST: textOf(icms, "vBCST"),
    IMPOSTO_ICMSST_PICMSST: textOf(icms, "pICMSST"),
    IMPOSTO_ICMSST_VICMSST: textOf(icms, "vICMSST"),
    IMPOSTO_ICMSST_modBCST: textOf(icms, "modBCST"),
    IMPOSTO_ICMS_qBCMonoRet: textOf(icms, "qBCMonoRet"),
    IMPOSTO_ICMS_vICMSMonoRet: textOf(icms, "vICMSMonoRet"),
    IMPOSTO_PIS_VPIS: textOf(pis, "vPIS"),
    IMPOSTO_PIS_VBC: textOf(pis, "vBC"),
    IMPOSTO_PIS_PPIS: textOf(pis, "pPIS"),
    IMPOSTO_PIS_CST: textOf(pis, "CST"),
    IMPOSTO_COFINS_VCOFINS: textOf(cofins, "vCOFINS"),
    IMPOSTO_COFINS_VBC: textOf(cofins, "vBC"),
    IMPOSTO_COFINS_PCOFINS: textOf(cofins, "pCOFINS"),
    IMPOSTO_COFINS_CST: textOf(cofins, "CST"),
    IMPOSTO_IPI_cEnq: textOf(ipi, "cEnq"),
    IMPOSTO_IPI_CSTC: textOf(ipi, "CST"),
    IMPOSTO_IPI_vBC: textOf(ipi, "vBC"),
    IMPOSTO_IPI_pIPI: textOf(ipi, "pIPI"),
    IMPOSTO_IPI_vIPI: textOf(ipi, "vIPI"),
  };
}

export function parseNfe(bytes: Uint8Array): NfeTables {
  const root = parseXml(decodeXml(bytes));
  const inf = infNFeOf(root);
  const cnpjEmit = textOf(find(inf, "emit"), "CNPJ") ?? textOf(find(inf, "emit"), "CPF");
  if (!cnpjEmit) throw new FiscalFileError("NF-e sem CNPJ do emitente.");
  const header = headerFields(root, inf, chaveOf(inf, root), cnpjEmit);

  const itens: Row[] = childrenNamed(inf, "det").map((det, i) => {
    const values = { ...header, ...itemFields(det, i) };
    return Object.fromEntries(NFE_COLUMNS.map((c) => [c.name, values[c.header] ?? null]));
  });
  return { nfe_itens: itens };
}
