/**
 * EFD ICMS/IPI (SPED Fiscal) → tables of the "efd-icms-ipi" template.
 *
 * Fact `documentos_analitico`: the analytic records (C190, C590, C490, C850, D190, D590), one per
 * document × CST × CFOP × rate, inheriting operation, document and participant from their parent.
 */
import {
  FiscalFileError, scopedKey, spedDate, spedMonth, spedNumber, text, ufFromMunicipio,
  type Row, type SpedIdentity, type SpedRecord,
} from "./sped";

export interface EfdIcmsTables {
  documentos_analitico: Row[];
  estabelecimentos: Row[];
  participantes: Row[];
}

/** 0000: |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|IM|SUFRAMA|IND_PERFIL|IND_ATIV| */
export function identifyEfdIcms(records: readonly SpedRecord[]): SpedIdentity & { uf: string | null; ie: string | null } {
  const r = records[0];
  // The 0000 of EFD Contribuições starts with TIPO_ESCRIT (0/1) and has DT_INI in field 5.
  if (!r || r[0] !== "0000" || !spedDate(r[3]) || !spedDate(r[4]) || !(text(r[6]) ?? text(r[7]))) {
    throw new FiscalFileError("Este arquivo não parece uma EFD ICMS/IPI (registro 0000 não confere).");
  }
  const cnpj = text(r[6]) ?? (text(r[7]) as string);
  return { cnpj, nome: text(r[5]) ?? cnpj, periodo: spedMonth(r[3]) as string, dtFin: spedDate(r[4]), uf: text(r[8]), ie: text(r[9]) };
}

interface Header {
  indOper: string | null;
  codMod: string | null;
  codSit: string | null;
  serie: string | null;
  numDoc: string | null;
  chave: string | null;
  dtDoc: string | null;
  idPart: string | null;
}

const EMPTY: Header = { indOper: null, codMod: null, codSit: null, serie: null, numDoc: null, chave: null, dtDoc: null, idPart: null };

/** Parent records and where their fields are. */
function header(r: SpedRecord, cnpj: string): Header | null {
  switch (r[0]) {
    // |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|…
    case "C100":
      return { indOper: text(r[1]), codMod: text(r[4]), codSit: text(r[5]), serie: text(r[6]), numDoc: text(r[7]),
        chave: text(r[8]), dtDoc: spedDate(r[9]), idPart: scopedKey(cnpj, r[3]) };
    // |C500|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|COD_CONS|NUM_DOC|DT_DOC|DT_E_S|…
    case "C500":
      return { indOper: text(r[1]), codMod: text(r[4]), codSit: text(r[5]), serie: text(r[6]), numDoc: text(r[9]),
        chave: null, dtDoc: spedDate(r[10]), idPart: scopedKey(cnpj, r[3]) };
    // |C405|DT_DOC|CRO|CRZ|NUM_COO_FIN|GT_FIN|VL_BRT| — reduction Z of a fiscal printer (always sales)
    case "C405":
      return { ...EMPTY, indOper: "1", codMod: "2D", numDoc: text(r[3]), dtDoc: spedDate(r[1]) };
    // |C800|COD_MOD|COD_SIT|NUM_CFE|DT_DOC|VL_CFE|VL_PIS|VL_COFINS|CNPJ_CPF|NR_SAT|CHV_CFE|… — CF-e SAT (always sales)
    case "C800":
      return { ...EMPTY, indOper: "1", codMod: text(r[1]), codSit: text(r[2]), numDoc: text(r[3]), dtDoc: spedDate(r[4]), chave: text(r[10]) };
    // |D100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|NUM_DOC|CHV_CTE|DT_DOC|DT_A_P|…
    case "D100":
      return { indOper: text(r[1]), codMod: text(r[4]), codSit: text(r[5]), serie: text(r[6]), numDoc: text(r[8]),
        chave: text(r[9]), dtDoc: spedDate(r[10]), idPart: scopedKey(cnpj, r[3]) };
    // |D500|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|NUM_DOC|DT_DOC|DT_A_P|…
    case "D500":
      return { indOper: text(r[1]), codMod: text(r[4]), codSit: text(r[5]), serie: text(r[6]), numDoc: text(r[8]),
        chave: null, dtDoc: spedDate(r[9]), idPart: scopedKey(cnpj, r[3]) };
    default:
      return null;
  }
}

interface Analytic {
  cst: string | undefined;
  cfop: string | undefined;
  aliq: string | undefined;
  vlOpr: string | undefined;
  vlBc: string | undefined;
  vlIcms: string | undefined;
  vlBcSt?: string;
  vlSt?: string;
  vlRedBc?: string;
  vlIpi?: string;
}

/** Analytic records and where their fields are. */
function analytic(r: SpedRecord): Analytic | null {
  switch (r[0]) {
    // |C190|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|COD_OBS|
    case "C190":
    // |C590|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|COD_OBS|
    case "C590":
      return { cst: r[1], cfop: r[2], aliq: r[3], vlOpr: r[4], vlBc: r[5], vlIcms: r[6], vlBcSt: r[7], vlSt: r[8], vlRedBc: r[9],
        vlIpi: r[0] === "C190" ? r[10] : undefined };
    // |C490|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|COD_OBS|  and  |C850| with the same layout
    case "C490":
    case "C850":
      return { cst: r[1], cfop: r[2], aliq: r[3], vlOpr: r[4], vlBc: r[5], vlIcms: r[6] };
    // |D190|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_RED_BC|COD_OBS|
    case "D190":
      return { cst: r[1], cfop: r[2], aliq: r[3], vlOpr: r[4], vlBc: r[5], vlIcms: r[6], vlRedBc: r[7] };
    // |D590|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_UF|VL_ICMS_UF|VL_RED_BC|COD_OBS|
    case "D590":
      return { cst: r[1], cfop: r[2], aliq: r[3], vlOpr: r[4], vlBc: r[5], vlIcms: r[6], vlRedBc: r[9] };
    default:
      return null;
  }
}

/** |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|SUFRAMA|END|NUM|COMPL|BAIRRO| */
export function participante(r: SpedRecord, cnpj: string): Row {
  return {
    id_part: scopedKey(cnpj, r[1]),
    nome: text(r[2]) ?? text(r[1]),
    cnpj_cpf: text(r[4]) ?? text(r[5]),
    uf: ufFromMunicipio(r[7]),
  };
}

export function parseEfdIcms(records: readonly SpedRecord[]): EfdIcmsTables {
  const id = identifyEfdIcms(records);
  const docs: Row[] = [];
  const parts: Row[] = [];
  let parent: Header = EMPTY;
  let parentReg = "";

  for (const r of records) {
    if (r[0] === "0150") {
      parts.push(participante(r, id.cnpj));
      continue;
    }
    const h = header(r, id.cnpj);
    if (h) {
      parent = h;
      parentReg = r[0];
      continue;
    }
    const a = analytic(r);
    if (!a) continue;
    // An analytic record outside its block (malformed file) has no parent: skip it.
    if (parentReg === "" || parentReg[0] !== r[0][0]) continue;
    docs.push({
      cnpj: id.cnpj,
      periodo: id.periodo,
      registro: r[0],
      ind_oper: parent.indOper,
      cod_mod: parent.codMod,
      cod_sit: parent.codSit,
      serie: parent.serie,
      num_doc: parent.numDoc,
      chave: parent.chave,
      dt_doc: parent.dtDoc,
      id_part: parent.idPart,
      cst_icms: text(a.cst),
      cfop: text(a.cfop),
      aliq_icms: spedNumber(a.aliq),
      vl_opr: spedNumber(a.vlOpr) ?? "0",
      vl_bc_icms: spedNumber(a.vlBc),
      vl_icms: spedNumber(a.vlIcms),
      vl_bc_icms_st: spedNumber(a.vlBcSt),
      vl_icms_st: spedNumber(a.vlSt),
      vl_red_bc: spedNumber(a.vlRedBc),
      vl_ipi: spedNumber(a.vlIpi),
    });
  }

  return {
    documentos_analitico: docs,
    estabelecimentos: [{ cnpj: id.cnpj, nome: id.nome, uf: id.uf, ie: id.ie }],
    participantes: parts,
  };
}
