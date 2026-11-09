/**
 * EFD Contribuições (PIS/COFINS) → tables of the "efd-contribuicoes" template.
 *
 * Fact `itens_pis_cofins`: one row per item with PIS/COFINS. Registers that carry PIS and COFINS on
 * separate lines (C181/C185, C191/C195, D201/D205) become two rows; the COFINS one has vl_item = 0
 * so revenue is not counted twice.
 */
import { participante } from "./efd-icms-ipi";
import {
  FiscalFileError, scopedKey, spedDate, spedMonth, spedNumber, text,
  type Row, type SpedIdentity, type SpedRecord,
} from "./sped";

export interface EfdContribTables {
  itens_pis_cofins: Row[];
  estabelecimentos: Row[];
  participantes: Row[];
  itens: Row[];
}

/** 0000: |0000|COD_VER|TIPO_ESCRIT|IND_SIT_ESP|NUM_REC_ANTERIOR|DT_INI|DT_FIN|NOME|CNPJ|UF|COD_MUN|SUFRAMA|IND_NAT_PJ|IND_ATIV| */
export function identifyEfdContrib(records: readonly SpedRecord[]): SpedIdentity & { uf: string | null } {
  const r = records[0];
  if (!r || r[0] !== "0000" || !spedDate(r[5]) || !spedDate(r[6]) || !text(r[8])) {
    throw new FiscalFileError("Este arquivo não parece uma EFD Contribuições (registro 0000 não confere).");
  }
  return { cnpj: text(r[8]) as string, nome: text(r[7]) ?? (text(r[8]) as string), periodo: spedMonth(r[5]) as string, dtFin: spedDate(r[6]), uf: text(r[9]) };
}

interface Doc {
  indOper: string | null;
  numDoc: string | null;
  dtDoc: string | null;
  idPart: string | null;
  idItem: string | null;
}

const NO_DOC: Doc = { indOper: null, numDoc: null, dtDoc: null, idPart: null, idItem: null };

interface Values {
  registro: string;
  cfop?: string;
  cstPis: string | undefined;
  cstCofins: string | undefined;
  natBcCred?: string;
  vlItem: string | null;
  bcPis?: string;
  aliqPis?: string;
  vlPis?: string;
  bcCofins?: string;
  aliqCofins?: string;
  vlCofins?: string;
  idItem?: string | null;
  idPart?: string | null;
  indOper?: string | null;
  numDoc?: string | null;
  dtDoc?: string | null;
}

export function parseEfdContrib(records: readonly SpedRecord[]): EfdContribTables {
  const id = identifyEfdContrib(records);
  const rows: Row[] = [];
  const estabs: Row[] = [{ cnpj: id.cnpj, nome: id.nome, uf: id.uf }];
  const parts: Row[] = [];
  const itens: Row[] = [];
  let estab = id.cnpj;
  let doc: Doc = NO_DOC;

  const push = (v: Values): void => {
    rows.push({
      cnpj: estab,
      periodo: id.periodo,
      registro: v.registro,
      ind_oper: v.indOper !== undefined ? v.indOper : doc.indOper,
      num_doc: v.numDoc !== undefined ? v.numDoc : doc.numDoc,
      dt_doc: v.dtDoc !== undefined ? v.dtDoc : doc.dtDoc,
      id_part: v.idPart !== undefined ? v.idPart : doc.idPart,
      id_item: v.idItem !== undefined ? v.idItem : doc.idItem,
      cfop: text(v.cfop),
      cst_pis: text(v.cstPis),
      cst_cofins: text(v.cstCofins),
      nat_bc_cred: text(v.natBcCred),
      vl_item: v.vlItem ?? "0",
      vl_bc_pis: spedNumber(v.bcPis),
      aliq_pis: spedNumber(v.aliqPis),
      vl_pis: spedNumber(v.vlPis),
      vl_bc_cofins: spedNumber(v.bcCofins),
      aliq_cofins: spedNumber(v.aliqCofins),
      vl_cofins: spedNumber(v.vlCofins),
    });
  };
  const item = (code: string | undefined): string | null => scopedKey(id.cnpj, code);

  for (const r of records) {
    switch (r[0]) {
      case "0150":
        parts.push(participante(r, id.cnpj));
        break;
      // |0140|COD_EST|NOME|CNPJ|UF|IE|COD_MUN|IM|SUFRAMA|
      case "0140":
        if (text(r[3])) estabs.push({ cnpj: text(r[3]), nome: text(r[2]) ?? text(r[3]), uf: text(r[4]) });
        break;
      // |0200|COD_ITEM|DESCR_ITEM|COD_BARRA|COD_ANT_ITEM|UNID_INV|TIPO_ITEM|COD_NCM|…
      case "0200":
        itens.push({ id_item: item(r[1]), descricao: text(r[2]) ?? text(r[1]), ncm: text(r[7]), tipo_item: text(r[6]) });
        break;
      // Establishment of the blocks that follow: |A010|CNPJ|, |C010|CNPJ|IND_ESCRI|, |D010|CNPJ|, |F010|CNPJ|
      case "A010":
      case "C010":
      case "D010":
      case "F010":
        estab = text(r[1]) ?? id.cnpj;
        doc = NO_DOC;
        break;
      // |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|CHV_NFSE|DT_DOC|…
      case "A100":
        doc = { indOper: text(r[1]), numDoc: text(r[7]), dtDoc: spedDate(r[9]), idPart: scopedKey(id.cnpj, r[3]), idItem: null };
        break;
      // |A170|NUM_ITEM|COD_ITEM|DESCR_COMPL|VL_ITEM|VL_DESC|NAT_BC_CRED|IND_ORIG_CRED|CST_PIS|VL_BC_PIS|ALIQ_PIS|VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|…
      case "A170":
        push({ registro: "A170", idItem: item(r[2]), vlItem: spedNumber(r[4]), natBcCred: r[6], cstPis: r[8], bcPis: r[9], aliqPis: r[10],
          vlPis: r[11], cstCofins: r[12], bcCofins: r[13], aliqCofins: r[14], vlCofins: r[15] });
        break;
      // |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|…
      case "C100":
        doc = { indOper: text(r[1]), numDoc: text(r[7]), dtDoc: spedDate(r[9]), idPart: scopedKey(id.cnpj, r[3]), idItem: null };
        break;
      // |C170|NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|COD_NAT|VL_BC_ICMS|ALIQ_ICMS|VL_ICMS|
      //  VL_BC_ICMS_ST|ALIQ_ST|VL_ICMS_ST|IND_APUR|CST_IPI|COD_ENQ|VL_BC_IPI|ALIQ_IPI|VL_IPI|CST_PIS|VL_BC_PIS|ALIQ_PIS|
      //  QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_COFINS|COD_CTA|
      case "C170":
        push({ registro: "C170", idItem: item(r[2]), vlItem: spedNumber(r[6]), cfop: r[10], cstPis: r[24], bcPis: r[25], aliqPis: r[26],
          vlPis: r[29], cstCofins: r[30], bcCofins: r[31], aliqCofins: r[32], vlCofins: r[35] });
        break;
      // |C175|CFOP|VL_OPR|VL_DESC|CST_PIS|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_COFINS|…
      case "C175":
        push({ registro: "C175", cfop: r[1], vlItem: spedNumber(r[2]), cstPis: r[4], bcPis: r[5], aliqPis: r[6], vlPis: r[9],
          cstCofins: r[10], bcCofins: r[11], aliqCofins: r[12], vlCofins: r[15] });
        break;
      // |C180|COD_MOD|DT_DOC_INI|DT_DOC_FIN|COD_ITEM|COD_NCM|EX_IPI|VL_TOT_ITEM|  (sales, consolidated by item)
      // |C190|COD_MOD|DT_REF_INI|DT_REF_FIN|COD_ITEM|COD_NCM|EX_IPI|VL_TOT_ITEM|  (purchases, consolidated by item)
      case "C180":
      case "C190":
        doc = { indOper: r[0] === "C180" ? "1" : "0", numDoc: null, dtDoc: spedDate(r[3]), idPart: null, idItem: item(r[4]) };
        break;
      // |C181|CST_PIS|CFOP|VL_ITEM|VL_DESC|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS|COD_CTA|
      case "C181":
        push({ registro: "C181", cfop: r[2], vlItem: spedNumber(r[3]), cstPis: r[1], cstCofins: r[1], bcPis: r[5], aliqPis: r[6], vlPis: r[9] });
        break;
      // |C185|CST_COFINS|CFOP|VL_ITEM|VL_DESC|VL_BC_COFINS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_COFINS|COD_CTA|
      case "C185":
        push({ registro: "C185", cfop: r[2], vlItem: "0", cstPis: r[1], cstCofins: r[1], bcCofins: r[5], aliqCofins: r[6], vlCofins: r[9] });
        break;
      // |C191|CNPJ_CPF_PART|CST_PIS|CFOP|VL_ITEM|VL_DESC|VL_BC_PIS|ALIQ_PIS|QUANT_BC_PIS|ALIQ_PIS_QUANT|VL_PIS|COD_CTA|
      case "C191":
        push({ registro: "C191", cfop: r[3], vlItem: spedNumber(r[4]), cstPis: r[2], cstCofins: r[2], bcPis: r[6], aliqPis: r[7], vlPis: r[10] });
        break;
      // |C195|CNPJ_CPF_PART|CST_COFINS|CFOP|VL_ITEM|VL_DESC|VL_BC_COFINS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_COFINS|COD_CTA|
      case "C195":
        push({ registro: "C195", cfop: r[3], vlItem: "0", cstPis: r[2], cstCofins: r[2], bcCofins: r[6], aliqCofins: r[7], vlCofins: r[10] });
        break;
      // |D200|COD_MOD|COD_SIT|SER|SUB|NUM_DOC_INI|NUM_DOC_FIN|CFOP|DT_REF|VL_DOC|VL_DESC|  (transport, consolidated)
      case "D200":
        doc = { indOper: "1", numDoc: text(r[5]), dtDoc: spedDate(r[8]), idPart: null, idItem: null };
        break;
      // |D201|CST_PIS|VL_ITEM|VL_BC_PIS|ALIQ_PIS|VL_PIS|COD_CTA|
      case "D201":
        push({ registro: "D201", vlItem: spedNumber(r[2]), cstPis: r[1], cstCofins: r[1], bcPis: r[3], aliqPis: r[4], vlPis: r[5] });
        break;
      // |D205|CST_COFINS|VL_ITEM|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|COD_CTA|
      case "D205":
        push({ registro: "D205", vlItem: "0", cstPis: r[1], cstCofins: r[1], bcCofins: r[3], aliqCofins: r[4], vlCofins: r[5] });
        break;
      // |F100|IND_OPER|COD_PART|COD_ITEM|DT_OPER|VL_OPER|CST_PIS|VL_BC_PIS|ALIQ_PIS|VL_PIS|CST_COFINS|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|NAT_BC_CRED|…
      // IND_OPER: 0 = operation with credit right, 1 and 2 = revenue.
      case "F100":
        push({ registro: "F100", indOper: text(r[1]) === "0" ? "0" : "1", numDoc: null, dtDoc: spedDate(r[4]), idPart: scopedKey(id.cnpj, r[2]),
          idItem: item(r[3]), vlItem: spedNumber(r[5]), cstPis: r[6], bcPis: r[7], aliqPis: r[8], vlPis: r[9], cstCofins: r[10],
          bcCofins: r[11], aliqCofins: r[12], vlCofins: r[13], natBcCred: r[14] });
        break;
      default:
        break;
    }
  }

  return {
    itens_pis_cofins: rows.filter((r) => r.cst_pis !== null && r.cst_cofins !== null),
    estabelecimentos: estabs,
    participantes: parts,
    itens,
  };
}
