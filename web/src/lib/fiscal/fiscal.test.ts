import { describe, expect, it } from "vitest";
import { csvLine, toCsv } from "./csv";
import { fiscalImporterFor, mergeByKey, readSpedFile } from "./importers";
import { parseNfe } from "./nfe";
import { columnName, NFE_COLUMNS } from "./nfe-layout";
import { parseLine, readSped, spedDate, spedNumber, type Cell } from "./sped";
import { factColumns, spedKindFor, SPED_KINDS, type SpedKind } from "./sped-kinds";
import { asLatin1 as latin1, ECD, EFD_CONTRIB, EFD_ICMS, nfeXml as NFE } from "./test-fixtures";

const kind = (id: string): SpedKind => {
  const k = spedKindFor(id);
  if (!k) throw new Error(`no kind ${id}`);
  return k;
};

/** Rows of one record type as objects keyed by column name, with the original fields named by the layout. */
function rowsOf(k: SpedKind, bytes: Uint8Array, registro: string): Record<string, Cell>[] {
  const { columns, rows } = readSpedFile(k, bytes);
  const names = k.layout[registro]?.c ?? [];
  return rows
    .map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])))
    .filter((r) => r.registro === registro)
    .map((r) => ({ ...r, ...Object.fromEntries(names.map((n, i) => [n, r[`c${String(i + 1).padStart(2, "0")}`]])) }));
}

describe("sped helpers", () => {
  it("reads records, dates and decimal commas", () => {
    expect(readSped(latin1("|0000|x|\n|C190|a||b|\n|9999|2|\nlixo"))).toEqual([["0000", "x"], ["C190", "a", "", "b"], ["9999", "2"]]);
    expect(parseLine("  |C100|1||\r")).toEqual(["C100", "1", ""]);
    expect(parseLine("assinatura")).toBeNull();
    expect(spedDate("05012025")).toBe("2025-01-05");
    expect(spedNumber("1234,56")).toBe("1234.56");
    expect(spedNumber("")).toBeNull();
  });
});

describe("layouts", () => {
  it.each(SPED_KINDS.map((k) => [k.templateId, k] as const))("%s fits the fact width and names every field once", (_, k) => {
    for (const [code, rec] of Object.entries(k.layout)) {
      expect(rec.c.length, code).toBeLessThanOrEqual(k.width);
      expect(new Set(rec.c).size, code).toBe(rec.c.length);
    }
    expect(factColumns(k).slice(0, 9)).toEqual(["arquivo", "cnpj", "periodo", "linha", "bloco", "registro", "doc", "dt_doc", "oper"]);
  });
});

describe("EFD ICMS/IPI", () => {
  const k = kind("efd-icms-ipi");

  it("keeps every line with its original fields, in file order", () => {
    const { rows } = readSpedFile(k, EFD_ICMS);
    expect(rows.map((r) => r[5])).toEqual(["0000", "0150", "0200", "C100", "C170", "C190", "C100", "C190", "C190", "9999"]);
    expect(rows.map((r) => r[3])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(rowsOf(k, EFD_ICMS, "C170")[0]).toMatchObject({ doc: "123", oper: "0", id_item: "11222333000181-P1", VL_ITEM: "1000,00", CFOP: "2102" });
  });

  it("gives each analytic record the document, date and operation of its note", () => {
    const [first, second, third] = rowsOf(k, EFD_ICMS, "C190");
    expect(first).toMatchObject({
      arquivo: "11222333000181-2025-01", cnpj: "11222333000181", periodo: "2025-01-01", bloco: "C",
      doc: "123", dt_doc: "2025-01-05", oper: "0", CST_ICMS: "000", CFOP: "2102", ALIQ_ICMS: "12,00", VL_ICMS: "120,00", VL_IPI: "50,00",
    });
    expect(second).toMatchObject({ doc: "900", oper: "1", CFOP: "5102" });
    expect(third).toMatchObject({ doc: "900", oper: "1", CFOP: "5405", VL_OPR: "200,00" });
  });

  it("links notes to participants and builds the dimensions", () => {
    expect(rowsOf(k, EFD_ICMS, "C100")[0]).toMatchObject({ id_part: "11222333000181-F01", NUM_DOC: "123", VL_DOC: "1000,00" });
    expect(rowsOf(k, EFD_ICMS, "C100")[1]).toMatchObject({ id_part: null });
    const { dimensions } = readSpedFile(k, EFD_ICMS);
    expect(dimensions.estabelecimentos).toEqual([{ cnpj: "11222333000181", nome: "AUTO PEÇAS TESTE LTDA", uf: "SP" }]);
    expect(dimensions.participantes).toEqual([{ id_part: "11222333000181-F01", nome: "FORNECEDOR UM", cnpj_cpf: "44555666000199", uf: "PR" }]);
  });

  it("refuses another SPED", () => {
    expect(() => readSpedFile(k, EFD_CONTRIB)).toThrow(/EFD ICMS\/IPI/);
  });
});

describe("EFD Contribuições", () => {
  const k = kind("efd-contribuicoes");

  it("reads items with PIS/COFINS, the establishment of their block and their links", () => {
    expect(rowsOf(k, EFD_CONTRIB, "C170")[0]).toMatchObject({
      cnpj: "11222333000181", doc: "77", oper: "1", id_item: "11222333000181-P1", VL_ITEM: "1000,00", CFOP: "5102",
      CST_PIS: "01", VL_PIS: "16,50", CST_COFINS: "01", VL_COFINS: "76,00",
    });
    expect(rowsOf(k, EFD_CONTRIB, "F100")[0]).toMatchObject({
      oper: "0", dt_doc: "2025-01-20", id_part: "11222333000181-C01", CST_PIS: "50", VL_PIS: "3,30", NAT_BC_CRED: "13",
    });
  });

  it("builds items and establishments", () => {
    const { dimensions } = readSpedFile(k, EFD_CONTRIB);
    expect(dimensions.itens).toEqual([{ id_item: "11222333000181-P1", cod_item: "P1", descricao: "AMORTECEDOR", ncm: "87088000", tipo_item: "00" }]);
    expect(dimensions.estabelecimentos).toHaveLength(1);
  });
});

describe("ECD", () => {
  const k = kind("ecd");

  it("keeps balances as they came, with their period and account", () => {
    expect(rowsOf(k, ECD, "I155")).toMatchObject([
      { periodo: "2025-01-01", id_cta: "11222333000181-1.1.01", VL_SLD_INI: "100,00", IND_DC_INI: "D", VL_SLD_FIN: "120,00", IND_DC_FIN: "D" },
      { periodo: "2025-01-01", id_cta: "11222333000181-3.01", VL_CRED: "500,00", VL_SLD_FIN: "500,00", IND_DC_FIN: "C" },
    ]);
  });

  it("rolls each account up to its level 1–3 groups and keeps the referential account", () => {
    const { dimensions } = readSpedFile(k, ECD);
    expect(dimensions.plano_contas.find((c) => c.cod_cta === "1.1.01")).toMatchObject({
      natureza: "01", nivel: "3", grupo_1: "ATIVO", grupo_2: "ATIVO CIRCULANTE", grupo_3: "CAIXA", cod_cta_ref: "1.01.01.01.01",
    });
    expect(dimensions.plano_contas.find((c) => c.cod_cta === "3.01")).toMatchObject({ grupo_1: "RESULTADO", grupo_2: "RECEITA DE VENDAS", grupo_3: null });
  });
});

describe("NF-e", () => {
  it("reads one row per item with header, taxes and entities decoded", () => {
    const t = parseNfe(NFE());
    expect(t.nfe_itens).toHaveLength(2);
    expect(t.nfe_itens[0]).toMatchObject({
      chnfe_xml: "1".repeat(44), chave_de_acesso2: `NFe${"1".repeat(44)}`, xml_versao: "4.00", prod_item: "1", nnf: "321", ide_nnf: "321", ide_mod: "55",
      emissao_data: "2025-02-14", emissao_ano: "2025", emissao_mes: "fev", emissao_dia: "14", emissao_hora: "10:00", arquivo_competencia: "202502",
      emit_cnpj: "11222333000181", emit_nome: "AUTO PEÇAS & CIA", dest_cnpj: "12345678909", dest_nome: "CONSUMIDOR",
      prod_cfop: "6102", prod_qcom: "2.0000", prod_vprod: "300.00", prod_vdesc: "10.00",
      imposto_icms_cst: "00", imposto_icms_vbc: "290.00", imposto_icms_picms: "12.00", imposto_icms_vicms: "34.80", prod_vicms: "34.80",
      imposto_pis_cst: "01", imposto_pis_vpis: "4.79", imposto_cofins_vcofins: "22.04",
    });
    expect(t.nfe_itens[1]).toMatchObject({ prod_item: "2", imposto_icms_cst: "500", imposto_icms_vicms: null, imposto_pis_cst: null });
    // What only the field extraction knows stays empty when the row comes from a single XML.
    expect(t.nfe_itens[0]).toMatchObject({ registro: null, empresa: null, emitente: null, ncm_monofasico: null, contem_sped_icms: null });
  });

  it("gives every row the columns of the layout, in the order of the extraction file", () => {
    const names = NFE_COLUMNS.map((c) => c.name);
    expect(names).toHaveLength(106);
    expect(new Set(names).size).toBe(106);
    expect(names.slice(0, 3)).toEqual(["registro", "nome_arquivo_txt", "xml_versao"]);
    expect(names[names.length - 1]).toBe("arquivo_competencia");
    expect(columnName("EMISSÃO_MÊS_SAI")).toBe("emissao_mes_sai");
    expect(Object.keys(parseNfe(NFE()).nfe_itens[0])).toEqual(names);
  });

  it("refuses rejected documents and events", () => {
    expect(() => parseNfe(NFE("301"))).toThrow(/não autorizada/);
    expect(() => parseNfe(new TextEncoder().encode("<procEventoNFe><evento/></procEventoNFe>"))).toThrow(/evento/);
  });
});

describe("importers", () => {
  it("identify where each file goes, from its first bytes", () => {
    expect(fiscalImporterFor("efd-icms-ipi")?.identify(EFD_ICMS)).toMatchObject({ cnpj: "11222333000181", periodo: "2025-01", documentId: "efd-icms-ipi" });
    expect(fiscalImporterFor("ecd")?.identify(ECD.subarray(0, 200))).toMatchObject({ cnpj: "11222333000181", periodo: "2025-01" });
    expect(fiscalImporterFor("nfe")?.identify(NFE())).toMatchObject({ cnpj: "11222333000181", periodo: "2025-02", documentId: "1".repeat(44) });
    expect(fiscalImporterFor("vendas-executivo")).toBeNull();
  });

  it("merge the dimensions of several files by key", () => {
    const one = readSpedFile(kind("efd-icms-ipi"), EFD_ICMS).dimensions;
    const merged = mergeByKey({ participantes: "id_part", estabelecimentos: "cnpj" }, [one, one]);
    expect(merged.participantes).toHaveLength(1);
    expect(merged.estabelecimentos).toHaveLength(1);
  });

  it("writes CSV with quoting and empty nulls", () => {
    expect(toCsv(["a", "b"], [{ a: 'x,"y"', b: null }])).toBe('a,b\n"x,""y""",\n');
    expect(csvLine(["1", null, "a;b"])).toBe("1,,a;b\n");
  });
});
