import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { parseEcd } from "./ecd";
import { parseEfdContrib } from "./efd-contribuicoes";
import { parseEfdIcms } from "./efd-icms-ipi";
import { fiscalImporterFor, mergeTables } from "./importers";
import { parseNfe } from "./nfe";
import { readSped, spedDate, spedNumber } from "./sped";

import { ECD, EFD_CONTRIB, EFD_ICMS, asLatin1 as latin1, nfeXml as NFE } from "./test-fixtures";

describe("sped helpers", () => {
  it("reads records, dates and decimal commas", () => {
    expect(readSped(latin1("|0000|x|\n|C190|a||b|\n|9999|2|\nlixo"))).toEqual([["0000", "x"], ["C190", "a", "", "b"], ["9999", "2"]]);
    expect(spedDate("05012025")).toBe("2025-01-05");
    expect(spedNumber("1234,56")).toBe("1234.56");
    expect(spedNumber("")).toBeNull();
  });
});

describe("EFD ICMS/IPI", () => {
  const t = parseEfdIcms(readSped(EFD_ICMS));

  it("turns each C190 into a row with its document header", () => {
    expect(t.documentos_analitico).toHaveLength(3);
    expect(t.documentos_analitico[0]).toMatchObject({
      cnpj: "11222333000181", periodo: "2025-01-01", registro: "C190", ind_oper: "0", num_doc: "123",
      id_part: "11222333000181-F01", cst_icms: "000", cfop: "2102", aliq_icms: "12.00", vl_icms: "120.00", vl_ipi: "50.00",
    });
    expect(t.documentos_analitico[2]).toMatchObject({ ind_oper: "1", cfop: "5405", vl_opr: "200.00", id_part: null });
  });

  it("reads the declarant (accented name in ISO-8859-1) and participants with their UF", () => {
    expect(t.estabelecimentos).toEqual([{ cnpj: "11222333000181", nome: "AUTO PEÇAS TESTE LTDA", uf: "SP", ie: "123456789" }]);
    expect(t.participantes[0]).toMatchObject({ id_part: "11222333000181-F01", nome: "FORNECEDOR UM", uf: "PR" });
  });

  it("refuses another SPED", () => {
    expect(() => parseEfdIcms(readSped(EFD_CONTRIB))).toThrow(/EFD ICMS\/IPI/);
  });
});

describe("EFD Contribuições", () => {
  const t = parseEfdContrib(readSped(EFD_CONTRIB));

  it("reads C170 items and F100 operations with PIS/COFINS", () => {
    expect(t.itens_pis_cofins).toHaveLength(2);
    expect(t.itens_pis_cofins[0]).toMatchObject({
      registro: "C170", ind_oper: "1", id_item: "11222333000181-P1", id_part: "11222333000181-C01", cfop: "5102",
      cst_pis: "01", vl_item: "1000.00", vl_pis: "16.50", cst_cofins: "01", vl_cofins: "76.00",
    });
    expect(t.itens_pis_cofins[1]).toMatchObject({ registro: "F100", ind_oper: "0", cst_pis: "50", vl_pis: "3.30", nat_bc_cred: "13" });
  });

  it("reads items and establishments", () => {
    expect(t.itens).toEqual([{ id_item: "11222333000181-P1", descricao: "AMORTECEDOR", ncm: "87088000", tipo_item: "00" }]);
    expect(t.estabelecimentos.map((e) => e.cnpj)).toEqual(["11222333000181", "11222333000181"]);
  });
});

describe("ECD", () => {
  const t = parseEcd(readSped(ECD));

  it("signs balances (credit negative) by period", () => {
    expect(t.saldos_contas).toEqual([
      { cnpj: "11222333000181", periodo: "2025-01-01", id_cta: "11222333000181-1.1.01", cod_ccus: null,
        vl_sld_ini: "100.00", vl_deb: "50.00", vl_cred: "30.00", vl_sld_fin: "120.00" },
      { cnpj: "11222333000181", periodo: "2025-01-01", id_cta: "11222333000181-3.01", cod_ccus: null,
        vl_sld_ini: "0.00", vl_deb: "0.00", vl_cred: "500.00", vl_sld_fin: "-500.00" },
    ]);
  });

  it("rolls each account up to its level 1–3 groups and keeps the referential account", () => {
    const caixa = t.plano_contas.find((c) => c.cod_cta === "1.1.01");
    expect(caixa).toMatchObject({ natureza: "01", nivel: "3", grupo_1: "ATIVO", grupo_2: "ATIVO CIRCULANTE", grupo_3: "CAIXA", cod_cta_ref: "1.01.01.01.01" });
    expect(t.plano_contas.find((c) => c.cod_cta === "3.01")).toMatchObject({ grupo_1: "RESULTADO", grupo_2: "RECEITA DE VENDAS", grupo_3: null });
  });
});

describe("NF-e", () => {
  it("reads one row per item with header, taxes and entities decoded", () => {
    const t = parseNfe(NFE());
    expect(t.nfe_itens).toHaveLength(2);
    expect(t.nfe_itens[0]).toMatchObject({
      chave: "1".repeat(44), n_item: "1", numero: "321", dt_emissao: "2025-02-14", tp_nf: "1", cnpj_emit: "11222333000181",
      doc_dest: "12345678909", cfop: "6102", v_prod: "300.00", v_desc: "10.00", cst_icms: "00", v_icms: "34.80", v_pis: "4.79",
    });
    expect(t.nfe_itens[1]).toMatchObject({ cst_icms: "500", v_icms: null });
    expect(t.emitentes[0]).toEqual({ cnpj_emit: "11222333000181", nome: "AUTO PEÇAS & CIA", uf: "SP", municipio: "Sao Paulo" });
    expect(t.destinatarios[0]).toMatchObject({ doc_dest: "12345678909", uf: "PR" });
  });

  it("refuses rejected documents and events", () => {
    expect(() => parseNfe(NFE("301"))).toThrow(/não autorizada/);
    expect(() => parseNfe(new TextEncoder().encode("<procEventoNFe><evento/></procEventoNFe>"))).toThrow(/evento/);
  });
});

describe("importers", () => {
  it("identify where each file goes", () => {
    expect(fiscalImporterFor("efd-icms-ipi")?.identify(EFD_ICMS)).toMatchObject({ cnpj: "11222333000181", periodo: "2025-01", documentId: "efd-icms-ipi" });
    expect(fiscalImporterFor("nfe")?.identify(NFE())).toMatchObject({ cnpj: "11222333000181", periodo: "2025-02", documentId: "1".repeat(44) });
    expect(fiscalImporterFor("vendas-executivo")).toBeNull();
  });

  it("merge files: facts appended, dimensions by key", () => {
    const imp = fiscalImporterFor("efd-icms-ipi");
    if (!imp) throw new Error("importer missing");
    const one = imp.parse(EFD_ICMS);
    const merged = mergeTables(imp, [one, one]);
    expect(merged.documentos_analitico).toHaveLength(6);
    expect(merged.participantes).toHaveLength(1);
    expect(merged.estabelecimentos).toHaveLength(1);
  });

  it("writes CSV with quoting and empty nulls", () => {
    expect(toCsv(["a", "b"], [{ a: 'x,"y"', b: null }])).toBe('a,b\n"x,""y""",\n');
  });
});
