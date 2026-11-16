/** Inclusão de insumos (CR17): arquivos SPED sintéticos, pequenos, sem dado de empresa real. */
import { describe, expect, it } from "vitest";
import { tabelaCfopCredito, tabelaCfopDeTexto } from "./cfop-credito";
import { incluirInsumos, type OpcoesInclusao, type ResultadoInclusao } from "./inclusao-insumos";
import { lerEfdIcms, type EfdIcms } from "./inclusao-insumos-icms";
import { camposDe, recontarEncerramentos, regDe } from "./sped-linhas";

const MATRIZ = "11222333000181";
const FILIAL = "11222333000262";
const chave = (n: number): string => String(n).padStart(44, "0");

/** C100 da EFD ICMS/IPI (28 campos). */
function c100(k: number, extra: { oper?: string; part?: string; mod?: string; sit?: string } = {}): string {
  const c = ["C100", extra.oper ?? "0", "1", extra.part ?? "F02", extra.mod ?? "55", extra.sit ?? "00", "1", String(k), chave(k), "05012025", "06012025",
    "300,00", "1", "0", "", "300,00", "9", "", "", "", "300,00", "36,00", "", "", "", "4,95", "22,80", "", ""];
  return `|${c.join("|")}|`;
}

/** C170 da EFD ICMS/IPI (37 campos: o último, VL_ABAT_NT, não existe na EFD Contribuições). */
function c170(num: number, cfop: string, extra: { item?: string; unid?: string; nat?: string; cst?: string } = {}): string {
  const cst = extra.cst ?? "50";
  const c = ["C170", String(num), extra.item ?? "P2", "", "1", extra.unid ?? "CX", "100,00", "0", "0", "000", cfop, extra.nat ?? "N2", "100,00", "12,00", "12,00",
    "", "", "", "0", "", "", "", "", "", cst, "100,00", "1,65", "", "", "1,65", cst, "100,00", "7,60", "", "", "7,60", "CONTA1", "9,99"];
  return `|${c.join("|")}|`;
}

const CADASTROS_ICMS = [
  "|0150|F01|FORNECEDOR UM|01058|44555666000199||987|4106902||RUA|1||CENTRO|",
  "|0150|F02|FORNECEDOR DOIS|01058|55666777000188||555|4106902||AV|2||CENTRO|",
  "|0190|UN|UNIDADE|",
  "|0190|CX|CAIXA|",
  "|0190|PC|PECA|",
  "|0200|P1|AMORTECEDOR||||00|87088000||||12,00|0107500|",
  "|0200|P2|PASTILHA DE FREIO|789||PC|00|87083090||||12,00|0107700|",
  "|0400|N2|COMPRA PARA REVENDA|",
];

function icms(notas: string[], cnpj = MATRIZ, cadastros = CADASTROS_ICMS, mes = "012025"): EfdIcms {
  return lerEfdIcms("icms.txt", [
    `|0000|018|0|01${mes}|31${mes}|EMPRESA TESTE LTDA|${cnpj}||SP|123456789|3550308|IM9||A|1|`,
    "|0001|0|", ...cadastros, "|0990|0|", "|C001|0|", ...notas, "|C990|0|", "|9999|0|",
  ]);
}

/** EFD Contribuições de janeiro/2025 com a matriz, uma nota (chave 1) e a apuração no bloco M. */
function contrib(extra: { bloco0?: string[]; blocoC?: string[] } = {}): string[] {
  return recontarEncerramentos([
    `|0000|006|0|||01012025|31012025|EMPRESA TESTE LTDA|${MATRIZ}|SP|3550308||00|1|`,
    "|0001|0|",
    "|0110|1|1|1||",
    ...(extra.bloco0 ?? [
      `|0140||EMPRESA TESTE LTDA|${MATRIZ}|SP|123456789|3550308|||`,
      "|0150|F01|FORNECEDOR UM|01058|44555666000199||987|4106902||RUA|1||CENTRO|",
      "|0190|UN|UNIDADE|",
      "|0200|P1|AMORTECEDOR|||UN|00|87088000||||",
      "|0400|N1|COMPRA|",
    ]),
    "|0500|01012020|04|A|2|3.01|RECEITA|||",
    "|0990|0|",
    ...(extra.blocoC ?? [
      "|C001|0|",
      `|C010|${MATRIZ}|2|`,
      `|C100|0|1|F01|55|00|1|1|${chave(1)}|05012025|06012025|100,00|1|0||100,00|9||||||||||1,65|7,60|||`,
      "|C170|1|P1||1|UN|100,00|0|0|000|1102|N1|||||||0||||||50|100,00|1,65|||1,65|50|100,00|7,60|||7,60||",
      "|C400|2D|ECF|1|1|",
    ]),
    "|C990|0|",
    "|M001|0|",
    "|M200|26,40|3,30|0|23,10|0|0|23,10|0|0|0|0|23,10|",
    "|M990|3|",
    "|9001|0|",
    "|9990|0|",
    "|9999|0|",
  ], ["0", "C"]);
}

const OPCOES: OpcoesInclusao = { cfopCredito: new Set(["1102", "2102", "1202"]), chavesEscrituradas: new Set() };
const rodar = (notas: string[], opcoes: Partial<OpcoesInclusao> = {}, original = contrib()): ResultadoInclusao =>
  incluirInsumos(original, [icms(notas)], { ...OPCOES, ...opcoes });
const doTipo = (r: ResultadoInclusao, tipo: string) => r.relatorio.filter((l) => l.tipo === tipo);
const registros = (linhas: readonly string[]): string => linhas.map(regDe).join(" ");

describe("lerEfdIcms", () => {
  it("guarda os cadastros e só as notas de entrada, com os seus itens", () => {
    const e = icms([c100(2), c170(1, "1102"), "|C190|000|1102|12,00|100,00|100,00|12,00|||||", c100(3, { oper: "1" }), c170(1, "5102"), c100(4)]);
    expect(e.cnpj).toBe(MATRIZ);
    expect(e.mes).toBe("012025");
    expect(e.notas.map((n) => [n.campos[8], n.itens.length, n.linha])).toEqual([[chave(2), 1, 13], [chave(4), 0, 18]]);
    expect(e.participantes.get("F02")?.[2]).toBe("FORNECEDOR DOIS");
    expect(e.itens.get("P2")?.[12]).toBe("0107700");
  });

  it("recusa o que não é EFD ICMS/IPI", () => {
    expect(() => lerEfdIcms("x.txt", ["|0000|006|0|||01012025|31012025|EMPRESA|11222333000181|SP|"])).toThrow(/não é um arquivo da EFD ICMS/);
  });
});

describe("incluirInsumos: a nota, os itens e os cadastros", () => {
  const r = rodar([c100(2), c170(1, "1102"), c170(2, "1102", { item: "P1", unid: "UN" })]);

  it("copia o C100 como está e o C170 sem o último campo, sob o C010, depois das notas que já havia", () => {
    const iC010 = r.linhas.findIndex((l) => regDe(l) === "C010");
    expect(registros(r.linhas.slice(iC010, iC010 + 7))).toBe("C010 C100 C170 C100 C170 C170 C400");
    expect(r.linhas[iC010 + 3]).toBe(c100(2));
    const item = camposDe(r.linhas[iC010 + 4] ?? "");
    expect(item).toHaveLength(37);
    expect(item.at(-1)).toBe("CONTA1");
    expect(r.linhas[iC010 + 4]).toBe(c170(1, "1102").replace(/9,99\|$/, ""));
  });

  it("leva PIS/COFINS do item como estão, sem recalcular", () => {
    const item = camposDe(r.linhas.find((l) => l.startsWith("|C170|1|P2|")) ?? "");
    expect(item.slice(24, 36)).toEqual(["50", "100,00", "1,65", "", "", "1,65", "50", "100,00", "7,60", "", "", "7,60"]);
  });

  it("inclui no 0140 só os cadastros que faltam, na ordem dos registros, e o 0200 sem o CEST", () => {
    const i0140 = r.linhas.findIndex((l) => regDe(l) === "0140");
    expect(r.linhas.slice(i0140 + 1, i0140 + 11)).toEqual([
      "|0150|F01|FORNECEDOR UM|01058|44555666000199||987|4106902||RUA|1||CENTRO|",
      "|0150|F02|FORNECEDOR DOIS|01058|55666777000188||555|4106902||AV|2||CENTRO|",
      "|0190|UN|UNIDADE|",
      "|0190|PC|PECA|", // unidade de inventário do item P2
      "|0190|CX|CAIXA|",
      "|0200|P1|AMORTECEDOR|||UN|00|87088000||||",
      "|0200|P2|PASTILHA DE FREIO|789||PC|00|87083090||||12,00|",
      "|0400|N1|COMPRA|",
      "|0400|N2|COMPRA PARA REVENDA|",
      "|0500|01012020|04|A|2|3.01|RECEITA|||",
    ]);
    expect(doTipo(r, "cadastro incluído").map((l) => `${l.registro} ${l.codigo}`)).toEqual(["0150 F02", "0190 PC", "0190 CX", "0200 P2", "0400 N2"]);
  });

  it("não mexe no bloco M e avisa que a apuração é refeita no PVA", () => {
    expect(r.linhas.filter((l) => regDe(l).startsWith("M"))).toEqual(contrib().filter((l) => regDe(l).startsWith("M")));
    expect(doTipo(r, "aviso").some((l) => l.detalhe.includes("bloco M não foi alterado"))).toBe(true);
  });

  it("relata a nota como incluída com crédito, com o PIS e a COFINS dos itens", () => {
    expect(doTipo(r, "nota incluída com crédito")).toMatchObject([{ chave: chave(2), estabelecimento: MATRIZ, vl_pis: "3.30", vl_cofins: "15.20", linha: "13" }]);
    expect(r.resumo["nota incluída com crédito"]).toBe(1);
  });

  it("separa a nota incluída sem crédito (CST do PIS fora de 50 a 66)", () => {
    const semCredito = rodar([c100(2), c170(1, "1102", { cst: "70" })]);
    expect(doTipo(semCredito, "nota incluída sem crédito")).toMatchObject([{ chave: chave(2), vl_pis: "0.00" }]);
    expect(doTipo(semCredito, "nota incluída com crédito")).toEqual([]);
  });
});

describe("incluirInsumos: o que fica de fora", () => {
  const fora = (r: ResultadoInclusao) => doTipo(r, "nota deixada de fora").map((l) => `${Number(l.chave)} ${l.motivo}`);

  it("deixa fora modelo que não é 55, situação irregular, nota sem itens e saída", () => {
    const r = rodar([
      c100(2, { mod: "01" }), c170(1, "1102"), c100(3, { sit: "02" }), c170(1, "1102"), c100(4),
      c100(5, { oper: "1" }), c170(1, "5102"), c100(6, { sit: "08" }), c170(1, "1102"),
    ]);
    expect(fora(r)).toEqual(["2 modelo", "3 situação", "4 sem C170"]);
    expect(r.linhas.filter((l) => regDe(l) === "C100").map((l) => Number(camposDe(l)[8]))).toEqual([1, 6]);
  });

  it("deixa fora a chave já escriturada: no próprio arquivo, em outro mês ou repetida na EFD ICMS/IPI", () => {
    const r = rodar([c100(1), c170(1, "1102"), c100(7), c170(1, "1102"), c100(8), c170(1, "1102"), c100(8), c170(1, "1102")],
      { chavesEscrituradas: new Set([chave(7)]) });
    expect(fora(r)).toEqual(["1 já escriturada", "7 já escriturada", "8 já escriturada"]);
    expect(r.linhas.filter((l) => l.includes(chave(8)))).toHaveLength(1);
  });

  it("só inclui nota com CFOP que gera crédito", () => {
    const r = rodar([c100(2), c170(1, "1556"), c170(2, "1949"), c100(3), c170(1, "2102")]);
    expect(fora(r)).toEqual(["2 CFOP sem crédito"]);
    expect(doTipo(r, "nota deixada de fora")[0]?.detalhe).toBe("CFOP 1556, 1949");
    expect(r.linhas.filter((l) => regDe(l) === "C100")).toHaveLength(2);
  });

  it("nota com os dois tipos de CFOP entra inteira, e só o item de CFOP da tabela conta como crédito", () => {
    const r = rodar([c100(2), c170(1, "1102"), c170(2, "1556")]);
    expect(r.linhas.filter((l) => regDe(l) === "C170").map((l) => camposDe(l)[10])).toEqual(["1102", "1102", "1556"]);
    expect(doTipo(r, "nota incluída com crédito")[0]).toMatchObject({ vl_pis: "1.65", detalhe: expect.stringContaining("2 item(ns) incluído(s), 1 com CST") });
  });

  it("não inclui a nota cujo participante ou item já existe no 0140 com outro conteúdo, e lista o conflito", () => {
    const cadastros = CADASTROS_ICMS.map((l) => (l.startsWith("|0150|F01|") ? l.replace("44555666000199", "99888777000166") : l.startsWith("|0200|P1|") ? l.replace("87088000", "40111000") : l));
    const e = icms([c100(2, { part: "F01" }), c170(1, "1102"), c100(3), c170(1, "1102", { item: "P1", unid: "UN" }), c100(4), c170(1, "1102")], MATRIZ, cadastros);
    const r = incluirInsumos(contrib(), [e], OPCOES);
    expect(fora(r)).toEqual(["2 conflito de cadastro", "3 conflito de cadastro"]);
    expect(doTipo(r, "conflito de cadastro").map((l) => `${l.registro} ${l.codigo}`)).toEqual(["0150 F01", "0200 P1"]);
    expect(doTipo(r, "conflito de cadastro")[0]?.detalhe).toContain("44555666000199");
    expect(doTipo(r, "conflito de cadastro")[0]?.detalhe).toContain("99888777000166");
    expect(r.linhas.filter((l) => regDe(l) === "0150" && l.includes("|F01|"))).toHaveLength(1);
    expect(r.linhas.filter((l) => regDe(l) === "C100").map((l) => Number(camposDe(l)[8]))).toEqual([1, 4]);
  });

  it("deixa fora a nota que usa um cadastro que não está em nenhum dos dois arquivos", () => {
    const r = rodar([c100(2, { part: "F99" }), c170(1, "1102")]);
    expect(fora(r)).toEqual(["2 cadastro ausente"]);
  });
});

describe("incluirInsumos: estabelecimento sem 0140 ou sem C010", () => {
  it("cria o 0140 (com os cadastros) e o C010 da filial, depois dos que já existem", () => {
    const r = incluirInsumos(contrib(), [icms([c100(2), c170(1, "1102")], FILIAL)], OPCOES);
    const i = r.linhas.findIndex((l) => regDe(l) === "0140" && l.includes(FILIAL));
    expect(r.linhas.slice(i - 1, i + 7)).toEqual([
      "|0400|N1|COMPRA|",
      `|0140||EMPRESA TESTE LTDA|${FILIAL}|SP|123456789|3550308|IM9||`,
      "|0150|F02|FORNECEDOR DOIS|01058|55666777000188||555|4106902||AV|2||CENTRO|",
      "|0190|PC|PECA|",
      "|0190|CX|CAIXA|",
      "|0200|P2|PASTILHA DE FREIO|789||PC|00|87083090||||12,00|",
      "|0400|N2|COMPRA PARA REVENDA|",
      "|0500|01012020|04|A|2|3.01|RECEITA|||",
    ]);
    const c = r.linhas.findIndex((l) => l === `|C010|${FILIAL}|2|`);
    expect(registros(r.linhas.slice(c - 1, c + 4))).toBe("C400 C010 C100 C170 C990");
    expect(doTipo(r, "cadastro incluído").filter((l) => ["0140", "C010"].includes(l.registro)).map((l) => l.codigo)).toEqual([FILIAL, FILIAL]);
  });

  it("com matriz e filial no arquivo, cada cadastro e cada nota entra no seu estabelecimento", () => {
    const original = contrib({
      bloco0: [`|0140||MATRIZ|${MATRIZ}|SP|1|3550308|||`, "|0145|1|100,00|100,00|0||", "|0200|P1|AMORTECEDOR|||UN|00|87088000||||", "|0205|AMORTECEDOR ANTIGO|01012020|31122024||",
        `|0140||FILIAL|${FILIAL}|SP|2|3550308|||`, "|0150|F02|FORNECEDOR DOIS|01058|55666777000188||555|4106902||AV|2||CENTRO|"],
      blocoC: ["|C001|0|", `|C010|${MATRIZ}|2|`, `|C100|0|1|F01|55|00|1|1|${chave(1)}|05012025|06012025|100,00|`, `|C010|${FILIAL}|2|`, "|C400|2D|ECF|1|1|"],
    });
    const r = incluirInsumos(original, [icms([c100(2), c170(1, "1102")]), icms([c100(3), c170(1, "1102")], FILIAL)], OPCOES);
    const i = r.linhas.findIndex((l) => regDe(l) === "0140");
    expect(r.linhas.slice(i, i + 14).map((l) => camposDe(l).slice(0, 2).join(" "))).toEqual([
      "0140 ", "0145 1", "0150 F02", "0190 PC", "0190 CX", "0200 P1", "0205 AMORTECEDOR ANTIGO", "0200 P2", "0400 N2",
      "0140 ", "0150 F02", "0190 PC", "0190 CX", "0200 P2",
    ]);
    const c = r.linhas.indexOf("|C001|0|");
    expect(r.linhas.slice(c + 1, c + 9).map((l) => `${regDe(l)} ${Number(camposDe(l)[regDe(l) === "C100" ? 8 : 1]) || ""}`.trim())).toEqual([
      `C010 ${Number(MATRIZ)}`, "C100 1", "C100 2", "C170 1", `C010 ${Number(FILIAL)}`, "C100 3", "C170 1", "C400",
    ]);
  });

  it("dois estabelecimentos novos: cada 0140 com os seus cadastros e cada C010 com as suas notas", () => {
    const original = contrib({ bloco0: [], blocoC: ["|C001|1|"] });
    const r = incluirInsumos(original, [icms([c100(2), c170(1, "1102")]), icms([c100(3), c170(1, "1102")], FILIAL)], OPCOES);
    expect(registros(r.linhas.slice(2, 15))).toBe("0110 0140 0150 0190 0190 0200 0400 0140 0150 0190 0190 0200 0400");
    const c = r.linhas.indexOf("|C001|0|");
    expect(r.linhas.slice(c + 1, c + 8).map((l) => (regDe(l) === "C010" ? camposDe(l)[1] : regDe(l)))).toEqual([MATRIZ, "C100", "C170", FILIAL, "C100", "C170", "C990"]);
  });

  it("avisa dos itens com COD_CTA que não está no 0500 da EFD Contribuições", () => {
    const r = rodar([c100(2), c170(1, "1102")]);
    expect(doTipo(r, "aviso").filter((l) => l.registro === "C170")).toMatchObject([{ detalhe: expect.stringContaining("1 item(ns) incluído(s) com COD_CTA") }]);
  });

  it("aguenta um arquivo grande sem refazer a varredura a cada linha", () => {
    const existentes = Array.from({ length: 30_000 }, (_, n) => `|C100|0|1|F01|55|00|1|${n}|${chave(100_000 + n)}|05012025|06012025|100,00|`);
    const original = contrib({ blocoC: ["|C001|0|", `|C010|${MATRIZ}|2|`, ...existentes, "|C400|2D|ECF|1|1|"] });
    const novas = Array.from({ length: 3_000 }, (_, n) => [c100(200_000 + n), c170(1, "1102")]).flat();
    const inicio = performance.now();
    const r = incluirInsumos(original, [icms(novas)], OPCOES);
    expect(r.resumo["nota incluída com crédito"]).toBe(3_000);
    expect(performance.now() - inicio).toBeLessThan(5_000);
  });

  it("abre o bloco C que estava sem movimento e cria o primeiro 0140", () => {
    const original = contrib({ bloco0: [], blocoC: ["|C001|1|"] });
    const r = incluirInsumos(original, [icms([c100(2), c170(1, "1102")])], OPCOES);
    expect(registros(r.linhas.slice(2, 10))).toBe("0110 0140 0150 0190 0190 0200 0400 0500");
    const c = r.linhas.indexOf("|C001|0|");
    expect(registros(r.linhas.slice(c, c + 5))).toBe("C001 C010 C100 C170 C990");
  });

  it("avisa quando o estabelecimento escritura notas consolidadas (C180/C190)", () => {
    const original = contrib({ blocoC: ["|C001|0|", `|C010|${MATRIZ}|1|`, "|C190|55|01012025|31012025|P1|||100,00|"] });
    const r = incluirInsumos(original, [icms([c100(2), c170(1, "1102")])], OPCOES);
    const c = r.linhas.findIndex((l) => regDe(l) === "C010");
    expect(registros(r.linhas.slice(c, c + 4))).toBe("C010 C100 C170 C190");
    expect(doTipo(r, "aviso").some((l) => l.registro === "C010" && l.detalhe.includes("IND_ESCRI"))).toBe(true);
  });
});

describe("incluirInsumos: encerramentos, abertura e conferências", () => {
  it("reconta 0990, C990, 9900, 9990 e 9999", () => {
    const r = rodar([c100(2), c170(1, "1102"), c170(2, "1102", { item: "P1", unid: "UN" })]);
    const valor = (registro: string): string | undefined => camposDe(r.linhas.find((l) => regDe(l) === registro) ?? "")[1];
    const totalizado = Object.fromEntries(r.linhas.filter((l) => regDe(l) === "9900").map((l) => [camposDe(l)[1], Number(camposDe(l)[2])]));
    // bloco 0: 0000 0001 0110 0140 + 2×0150 + 3×0190 + 2×0200 + 2×0400 + 0500 0990 = 15
    expect(valor("0990")).toBe("15");
    // bloco C: C001 C010 + 2×C100 + 3×C170 + C400 C990 = 9
    expect(valor("C990")).toBe("9");
    expect(totalizado).toEqual({
      "0000": 1, "0001": 1, "0110": 1, "0140": 1, "0150": 2, "0190": 3, "0200": 2, "0400": 2, "0500": 1, "0990": 1,
      C001: 1, C010: 1, C100: 2, C170: 3, C400: 1, C990: 1, M001: 1, M200: 1, M990: 1, "9001": 1, "9900": 23, "9990": 1, "9999": 1,
    });
    expect(valor("9990")).toBe("26"); // 9001 + 23×9900 + 9990 + 9999
    expect(valor("9999")).toBe(String(r.linhas.length));
    expect(r.linhas).toHaveLength(15 + 9 + 3 + 26);
    expect(valor("M990")).toBe("3");
  });

  it("um arquivo sem nada a incluir sai igual ao original", () => {
    const r = rodar([c100(1), c170(1, "1102")]);
    expect(r.linhas).toEqual(contrib());
    expect(doTipo(r, "aviso").some((l) => l.detalhe.includes("não batem com a recontagem"))).toBe(false);
  });

  it("avisa quando os encerramentos do original já não batiam", () => {
    const original = contrib().map((l) => (regDe(l) === "C990" ? "|C990|99|" : l));
    expect(doTipo(rodar([], {}, original), "aviso").some((l) => l.detalhe.includes("não batem com a recontagem"))).toBe(true);
  });

  it("marca o 0000 como retificador quando recebe o recibo, e avisa quando não recebe", () => {
    const com = rodar([c100(2), c170(1, "1102")], { reciboAnterior: "1a.2b-3" });
    expect(camposDe(com.linhas[0] ?? "").slice(0, 6)).toEqual(["0000", "006", "1", "", "1A.2B-3", "01012025"]);
    const sem = rodar([c100(2), c170(1, "1102")]);
    expect(sem.linhas[0]).toBe(contrib()[0]);
    expect(doTipo(sem, "aviso").some((l) => l.detalhe.includes("não foi marcado como retificador"))).toBe(true);
    expect(() => rodar([], { reciboAnterior: "tem espaço" })).toThrow(/recibo/);
  });

  it("não copia a assinatura que vem depois do 9999 e avisa", () => {
    const r = rodar([c100(2), c170(1, "1102")], {}, [...contrib(), "SBRCAAEPDR0…assinatura…", ""]);
    expect(regDe(r.linhas.at(-1) ?? "")).toBe("9999");
    expect(doTipo(r, "aviso").some((l) => l.detalhe.includes("assinatura"))).toBe(true);
  });

  it("recusa EFD ICMS/IPI de outro mês, de outra empresa ou repetida para o mesmo estabelecimento", () => {
    expect(() => incluirInsumos(contrib(), [icms([], MATRIZ, CADASTROS_ICMS, "022025")], OPCOES)).toThrow(/é de 02\/2025/);
    expect(() => incluirInsumos(contrib(), [icms([], "99888777000166")], OPCOES)).toThrow(/não é da mesma empresa/);
    expect(() => incluirInsumos(contrib(), [icms([]), icms([])], OPCOES)).toThrow(/Mais de um arquivo/);
    expect(() => incluirInsumos(["|C001|0|"], [], OPCOES)).toThrow(/não é uma EFD Contribuições/);
  });
});

describe("tabela de CFOP que gera crédito", () => {
  it("a do repositório tem as compras para revenda e insumo e as devoluções de venda, sem imobilizado nem saídas", () => {
    const t = tabelaCfopCredito();
    for (const cfop of ["1102", "2102", "1101", "1403", "1202", "2411", "1922", "3102"]) expect(t.cfop.has(cfop)).toBe(true);
    for (const cfop of ["1551", "2551", "1949", "1152", "5102", "5202", "2203", "3201"]) expect(t.cfop.has(cfop)).toBe(false);
    expect(t.cfop.size).toBe(89);
    expect([...t.cfop].every((c) => /^[123]\d{3}$/.test(c))).toBe(true);
    expect(t.situacao).toContain("não conferida");
  });

  it("lê uma lista dada em texto, com ou sem ponto e descrição", () => {
    const t = tabelaCfopDeTexto("CFOP;Descrição\r\n1.102;Compra para comercialização\n2102\n5102;saída não entra\n\n", "lista.csv");
    expect([...t.cfop]).toEqual(["1102", "2102"]);
    expect(() => tabelaCfopDeTexto("nada", "vazia.txt")).toThrow(/nenhum CFOP/);
  });

  it("o filtro ignora o ponto do CFOP da nota", () => {
    const r = rodar([c100(2), c170(1, "1.102")]);
    expect(doTipo(r, "nota incluída com crédito")).toHaveLength(1);
  });
});
