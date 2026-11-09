/**
 * NF-e XML (one document per file: <nfeProc> or a bare <NFe>) → rows of the "nfe" template.
 *
 * Fact `nfe_itens`: one row per <det>, with the header (ide, emit, dest) repeated.
 * Events (cancellation, CC-e) and documents with a rejection status are refused.
 */
import { FiscalFileError, type Row } from "./sped";
import { childrenNamed, find, parseXml, textOf, type XmlNode } from "./xml";

export interface NfeTables {
  nfe_itens: Row[];
  emitentes: Row[];
  destinatarios: Row[];
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

/** Text of a direct-or-nested value inside one tax group (ICMS00, ICMSSN102 …): the first one found. */
const taxValue = (group: XmlNode | undefined, name: string): string | null => textOf(group, name);

export function parseNfe(bytes: Uint8Array): NfeTables {
  const root = parseXml(decodeXml(bytes));
  const inf = infNFeOf(root);
  const chave = chaveOf(inf, root);
  const ide = find(inf, "ide");
  const emit = find(inf, "emit");
  const dest = find(inf, "dest");
  const cnpjEmit = textOf(emit, "CNPJ") ?? textOf(emit, "CPF");
  if (!cnpjEmit) throw new FiscalFileError("NF-e sem CNPJ do emitente.");
  const docDest = dest ? (textOf(dest, "CNPJ") ?? textOf(dest, "CPF") ?? textOf(dest, "idEstrangeiro")) : null;
  const dtEmissao = issueDate(ide);

  const itens: Row[] = childrenNamed(inf, "det").map((det, i) => {
    const prod = find(det, "prod");
    const imposto = find(det, "imposto");
    const icms = find(imposto, "ICMS");
    return {
      chave,
      n_item: det.attrs.nItem ?? String(i + 1),
      numero: textOf(ide, "nNF"),
      serie: textOf(ide, "serie"),
      modelo: textOf(ide, "mod"),
      dt_emissao: dtEmissao,
      tp_nf: textOf(ide, "tpNF"),
      fin_nfe: textOf(ide, "finNFe"),
      cnpj_emit: cnpjEmit,
      doc_dest: docDest,
      cfop: textOf(prod, "CFOP"),
      ncm: textOf(prod, "NCM"),
      cod_prod: textOf(prod, "cProd"),
      x_prod: textOf(prod, "xProd") ?? textOf(prod, "cProd") ?? "(sem descrição)",
      u_com: textOf(prod, "uCom"),
      q_com: textOf(prod, "qCom"),
      v_prod: textOf(prod, "vProd") ?? "0",
      v_desc: textOf(prod, "vDesc"),
      v_frete: textOf(prod, "vFrete"),
      cst_icms: taxValue(icms, "CST") ?? taxValue(icms, "CSOSN"),
      v_bc_icms: taxValue(icms, "vBC"),
      v_icms: taxValue(icms, "vICMS"),
      v_icms_st: taxValue(icms, "vICMSST"),
      v_ipi: textOf(find(imposto, "IPI"), "vIPI"),
      v_pis: textOf(find(imposto, "PIS"), "vPIS"),
      v_cofins: textOf(find(imposto, "COFINS"), "vCOFINS"),
    };
  });

  const ender = (n: XmlNode | undefined, tag: string): XmlNode | undefined => find(n, tag);
  return {
    nfe_itens: itens,
    emitentes: [{
      cnpj_emit: cnpjEmit,
      nome: textOf(emit, "xNome") ?? cnpjEmit,
      uf: textOf(ender(emit, "enderEmit"), "UF"),
      municipio: textOf(ender(emit, "enderEmit"), "xMun"),
    }],
    destinatarios: docDest
      ? [{
          doc_dest: docDest,
          nome: textOf(dest, "xNome") ?? docDest,
          uf: textOf(ender(dest, "enderDest"), "UF"),
          municipio: textOf(ender(dest, "enderDest"), "xMun"),
        }]
      : [],
  };
}
