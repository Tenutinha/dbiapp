/**
 * Layout of the "nfe" template's fact table: one column per field of the NF-e field extraction
 * (a "|"-separated text with one line per item), in the order of that file. The column name is the
 * file's header in snake_case without accents; the header itself is kept as the label of the listings.
 *
 * Shared by the XML importer (nfe.ts), which fills what a single XML can tell, and by the template
 * generator (scripts/fiscal/gerar-molde-nfe.ts). Pure: no I/O.
 */
import type { ColumnType } from "../templates/schema";

export interface NfeColumn {
  /** Column of the fact table. */
  name: string;
  /** Header of the field in the extraction file. */
  header: string;
  type: ColumnType;
  required: boolean;
  description?: string;
  /** Group of the original-data listings the column is shown in. */
  group: NfeGroup;
}

export type NfeGroup = "nota" | "produto" | "icms" | "pis_cofins_ipi" | "emissao_ncm";

export const NFE_FACT = "nfe_itens";

/** "EMISSÃO_MÊS" → "emissao_mes"; "Chave de Acesso2" → "chave_de_acesso2". */
export function columnName(header: string): string {
  return header.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

type Spec = readonly [header: string, type?: ColumnType, description?: string];

/**
 * What every row must bring: the note it belongs to and when it was issued. The rest can be empty in real
 * extractions — a note issued by a person has a CPF and no EMIT_CNPJ, and some notes of third parties come
 * with the note's data only, without the item fields (PROD_ITEM, PROD_VPROD).
 */
const REQUIRED: ReadonlySet<string> = new Set(["chNFe_xml", "EMISSÃO_DATA"]);

const GROUPS: Readonly<Record<NfeGroup, readonly Spec[]>> = {
  nota: [
    ["Registro", "integer", "Número do registro na extração"],
    ["nome_arquivo_txt", "text", "Nome do arquivo XML de origem"],
    ["XML_versão"],
    ["EMPRESA", "text", "Identificação da empresa na extração"],
    ["NFE_CODIGO", "text", "Modelo do documento (55 = NF-e)"],
    ["Chave de Acesso2", "text", "Atributo Id do infNFe"],
    ["chNFe_xml", "text", "Chave de acesso (44 dígitos)"],
    ["Valor Unitario", "decimal"],
    ["nNF"],
    ["EMIT_CNPJ"],
    ["EMIT_NOME"],
    ["EMIT_NOME_FANTASIA"],
    ["EMIT_IE"],
    ["EMITENTE", "text", "PRÓPRIO quando a empresa emitiu a nota, TERCEIRO quando recebeu"],
    ["DEST_CNPJ", "text", "CNPJ ou CPF do destinatário"],
    ["DEST_NOME"],
    ["DEST_IE"],
    ["IDE_NNF"],
    ["IDE_NATOP"],
    ["IDE_MOD"],
    ["COBR_VLIQ", "decimal", "Valor líquido da fatura (repete em todos os itens da nota)"],
    ["INFADIC_FISCO"],
    ["INFADIC_CPL"],
    ["infAdProd"],
    ["infAdic", "text", "Grupo infAdic como veio no XML"],
    ["TOTAL_VPROD", "decimal", "Total dos produtos da nota (repete em todos os itens; some PROD_VPROD)"],
    ["INFNFESUPL_QRCODE"],
    ["INFNFESUPL_URLCHAVE"],
  ],
  produto: [
    ["PROD_CPROD"],
    ["PROD_cEAN"],
    ["PROD_XPROD"],
    ["PROD_NCM"],
    ["PROD_CEST"],
    ["PROD_indEscala"],
    ["PROD_CFOP"],
    ["PROD_UCOM"],
    ["PROD_QCOM", "decimal"],
    ["PROD_VUNCOM", "decimal"],
    ["PROD_VPROD", "decimal"],
    ["PROD_cEANTrib"],
    ["PROD_uTrib"],
    ["PROD_qTrib", "decimal"],
    ["PROD_vUnTrib", "decimal"],
    ["PROD_indTot"],
    ["PROD_VDESC", "decimal"],
    ["PROD_VICMS", "decimal", "Mesmo valor de IMPOSTO_ICMS_VICMS"],
    ["PROD_ITEM", "integer", "Número do item na nota"],
    ["PROD_CPRODANP"],
    ["PROD_CDESCANP"],
  ],
  icms: [
    ["IMPOSTO_ICMS_adRemICMSRet", "decimal"],
    ["IMPOSTO_ICMS_orig"],
    ["IMPOSTO_ICMS_CST", "text", "CST do ICMS (CSOSN nas notas do Simples lidas do XML)"],
    ["IMPOSTO_ICMS_VBCSTRET", "decimal"],
    ["IMPOSTO_ICMS_pST", "decimal"],
    ["IMPOSTO_ICMS_SUBSTITUTO", "decimal"],
    ["IMPOSTO_ICMS_vICMSSTRet", "decimal"],
    ["IMPOSTO_ICMS_pRedBCEfet", "decimal"],
    ["IMPOSTO_ICMS_vBCEfet", "decimal"],
    ["IMPOSTO_ICMS_pICMSEfet", "decimal"],
    ["IMPOSTO_ICMS_vICMSEfet", "decimal"],
    ["IMPOSTO_ICMS_VICMS", "decimal"],
    ["IMPOSTO_ICMS_VBC", "decimal"],
    ["IMPOSTO_ICMS_PICMS", "decimal"],
    ["IMPOSTO_ICMS_modBC"],
    ["IMPOSTO_ICMS_pMVAST", "decimal"],
    ["IMPOSTO_ICMSST_VRET", "decimal", "Mesmo valor de IMPOSTO_ICMS_vICMSSTRet"],
    ["IMPOSTO_ICMSST_VBCST", "decimal"],
    ["IMPOSTO_ICMSST_PICMSST", "decimal"],
    ["IMPOSTO_ICMSST_VICMSST", "decimal"],
    ["IMPOSTO_ICMSST_modBCST"],
    ["IMPOSTO_ICMS_qBCMonoRet", "decimal"],
    ["IMPOSTO_ICMS_vICMSMonoRet", "decimal"],
  ],
  pis_cofins_ipi: [
    ["IMPOSTO_PIS_VPIS", "decimal"],
    ["IMPOSTO_PIS_VBC", "decimal"],
    ["IMPOSTO_PIS_PPIS", "decimal"],
    ["IMPOSTO_PIS_CST"],
    ["IMPOSTO_COFINS_VCOFINS", "decimal"],
    ["IMPOSTO_COFINS_VBC", "decimal"],
    ["IMPOSTO_COFINS_PCOFINS", "decimal"],
    ["IMPOSTO_COFINS_CST"],
    ["IMPOSTO_IPI_cEnq"],
    ["IMPOSTO_IPI_CSTC", "text", "CST do IPI"],
    ["IMPOSTO_IPI_vBC", "decimal"],
    ["IMPOSTO_IPI_pIPI", "decimal"],
    ["IMPOSTO_IPI_vIPI", "decimal"],
  ],
  emissao_ncm: [
    ["chNFe", "text", "Chave de acesso do protocolo"],
    ["EMISSÃO_DATA", "date"],
    ["EMISSÃO_ANO"],
    ["EMISSÃO_MÊS", "text", "Mês abreviado (jan, fev…)"],
    ["EMISSÃO_DIA"],
    ["EMISSÃO_HORA"],
    ["EMISSÃO_DATA_SAI", "date", "Data de saída ou entrada"],
    ["EMISSÃO_ANO_SAI"],
    ["EMISSÃO_MÊS_SAI"],
    ["EMISSÃO_DIA_SAI"],
    ["EMISSÃO_HORA_SAI"],
    ["NCM_VIGÊNCIA", "text", "Enquadramento do NCM na tabela de PIS/COFINS da extração"],
    ["NCM_RELACIONAMENTO"],
    ["NCM_ALIQ_PIS", "decimal"],
    ["NCM_ALIQ_COFINS", "decimal"],
    ["NCM_VIGÊNCIA_DESC"],
    ["NCM_MONOFÁSICO", "text", "S quando o NCM é monofásico de PIS/COFINS"],
    ["CONTEM_SPED_PISCOFINS", "text", "S quando a nota consta na EFD Contribuições"],
    ["CONTEM_SPED_ICMS", "text", "S quando a nota consta na EFD ICMS/IPI"],
    ["TIPO_EMIT_DEST"],
    ["ARQUIVO_COMPETENCIA", "text", "Competência da nota (AAAAMM)"],
  ],
};

export const NFE_GROUP_TITLES: Readonly<Record<NfeGroup, string>> = {
  nota: "Nota, emitente e destinatário",
  produto: "Produto",
  icms: "ICMS e ICMS-ST",
  pis_cofins_ipi: "PIS, COFINS e IPI",
  emissao_ncm: "Emissão, NCM e conferência com o SPED",
};

/** Every column of the fact table, in the order of the extraction file. */
export const NFE_COLUMNS: readonly NfeColumn[] = (Object.entries(GROUPS) as [NfeGroup, readonly Spec[]][]).flatMap(
  ([group, specs]) =>
    specs.map(([header, type, description]) => ({
      name: columnName(header),
      header,
      type: type ?? "text",
      required: REQUIRED.has(header),
      ...(description ? { description } : {}),
      group,
    })),
);

/** Column name of a field of the extraction, by its header (fails loudly on a wrong name). */
export function nfeColumn(header: string): string {
  const found = NFE_COLUMNS.find((c) => c.header === header);
  if (!found) throw new Error(`nfe: o layout não tem o campo ${header}`);
  return found.name;
}
