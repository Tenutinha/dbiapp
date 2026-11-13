import { describe, expect, it } from "vitest";
import { pageText } from "./nfce";
import { parseNfceItems, withPageItems } from "./nfce-items";
import type { PurchaseDraft } from "./schema";

/**
 * Trecho da página pública de consulta de uma NFC-e no leiaute nacional (SP, PR, MG, BA…), como a
 * SEFAZ devolve — loja, CNPJ e códigos trocados por fictícios.
 */
const NATIONAL_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>NFC-e</title>
<script>var x = 1;</script></head><body>
<div id="conteudo">
  <div class="txtCenter"><div id="u20" class="txtTopo">MERCADO EXEMPLO LTDA</div>
  <div class="text">CNPJ: 12.345.678/0001-90</div></div>
  <table id="tabResult" data-filter="true" class="table table-striped">
    <tr id="Item + 1">
      <td valign="top">
        <span class="txtTit">CAFE 3 COR 250G TRAD V</span>
        <span class="RCod">(Código: 7896005800010 )</span><br />
        <span class="Rqtd"><strong>Qtde.:</strong>1</span>
        <span class="RUN"><strong>UN: </strong>UN</span>
        <span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;&nbsp;17,98</span>
      </td>
      <td align="right" valign="top" class="txtTit noWrap">Vl. Total<br /><span class="valor">17,98</span></td>
    </tr>
    <tr id="Item + 2">
      <td valign="top">
        <span class="txtTit2">BANANA PRATA KG</span>
        <span class="RCod">(Código: 2001 )</span><br />
        <span class="Rqtd"><strong>Qtde.:</strong>0,345</span>
        <span class="RUN"><strong>UN: </strong>KG</span>
        <span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;&nbsp;5,99</span>
      </td>
      <td align="right" valign="top" class="txtTit noWrap">Vl. Total<br /><span class="valor">2,07</span></td>
    </tr>
    <tr id="Item + 3">
      <td valign="top">
        <span class="txtTit">P&Atilde;O FRANC&Ecirc;S</span>
        <span class="RCod">(Código: 15 )</span><br />
        <span class="Rqtd"><strong>Qtde.:</strong>5</span>
        <span class="RUN"><strong>UN: </strong>UN</span>
        <span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;&nbsp;1,55</span>
      </td>
      <td align="right" valign="top" class="txtTit noWrap">Vl. Total<br /><span class="valor">7,75</span></td>
    </tr>
  </table>
  <div id="totalNota" class="txtRight">
    <div id="linhaTotal"><label>Qtd. total de itens:</label><span class="totalNumb">3</span></div>
    <div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">27,80</span></div>
    <div id="linhaTotal"><label class="tx">Cartão de Débito</label><span class="totalNumb">27,80</span></div>
  </div>
</div></body></html>`;

/** Leiaute em tabela com cabeçalho (RS e outros portais). */
const TABLE_PAGE = `<html><body>
<table class="NFCCabecalho"><tr><td>LOJA EXEMPLO</td></tr></table>
<table border="0" class="NFCDetalhe">
  <tr><td class="NFCDetalhe_Item">Código</td><td>Descrição</td><td>Qtde</td><td>Un</td><td>Vl Unit</td><td>Vl Total</td></tr>
  <tr><td>123</td><td>FURADEIRA IMPACTO 650W</td><td>1</td><td>UN</td><td>1.234,56</td><td>1.234,56</td></tr>
  <tr><td>456</td><td>BROCA 8MM</td><td>2,000</td><td>PC</td><td>12,50</td><td>25,00</td></tr>
</table></body></html>`;

const DRAFT: PurchaseDraft = {
  readable: true, supplier: "MERCADO EXEMPLO LTDA", purchasedOn: "2026-11-12", totalCents: 2780, paymentMethod: "debito", notes: null,
  // O que a IA devolveu na nota real: descrições certas, valores zerados.
  items: [{ description: "CAFE 3 COR 250G TRAD V", quantity: 1, unit: "un", unitPriceCents: null, totalCents: 0 }],
};

describe("itens da página da NFC-e", () => {
  it("lê o leiaute nacional com código, quantidade, unidade, unitário e valor", () => {
    const items = parseNfceItems(NATIONAL_PAGE);
    expect(items).toEqual([
      { description: "CAFE 3 COR 250G TRAD V", code: "7896005800010", quantity: 1, unit: "UN", unitPriceCents: 1798, totalCents: 1798 },
      { description: "BANANA PRATA KG", code: "2001", quantity: 0.345, unit: "KG", unitPriceCents: 599, totalCents: 207 },
      { description: "PÃO FRANCÊS", code: "15", quantity: 5, unit: "UN", unitPriceCents: 155, totalCents: 775 },
    ]);
  });

  it("a soma dos itens bate com o valor a pagar", () => {
    const sum = parseNfceItems(NATIONAL_PAGE).reduce((total, i) => total + i.totalCents, 0);
    expect(sum).toBe(2780);
    expect(pageText(NATIONAL_PAGE)).toContain("27,80");
  });

  it("lê a tabela com cabeçalho, com milhar e vírgula decimal", () => {
    expect(parseNfceItems(TABLE_PAGE)).toEqual([
      { description: "FURADEIRA IMPACTO 650W", code: "123", quantity: 1, unit: "UN", unitPriceCents: 123456, totalCents: 123456 },
      { description: "BROCA 8MM", code: "456", quantity: 2, unit: "PC", unitPriceCents: 1250, totalCents: 2500 },
    ]);
  });

  it("completa o que faltar: valor pela quantidade × unitário, unitário pelo valor ÷ quantidade", () => {
    const page = NATIONAL_PAGE
      .replace('<span class="valor">17,98</span>', '<span class="valor"></span>')
      .replace("<strong>Vl. Unit.:</strong>&nbsp;&nbsp;1,55", "<strong>Vl. Unit.:</strong>");
    const [cafe, , pao] = parseNfceItems(page);
    expect(cafe).toMatchObject({ unitPriceCents: 1798, totalCents: 1798 });
    expect(pao).toMatchObject({ unitPriceCents: 155, totalCents: 775 });
  });

  it("não inventa itens em página desconhecida ou de erro", () => {
    expect(parseNfceItems("<html><body><p>Nota não encontrada</p></body></html>")).toEqual([]);
    expect(parseNfceItems("<table><tr><td>Captcha</td></tr></table>")).toEqual([]);
  });
});

describe("itens da página no lugar dos da IA", () => {
  it("troca os itens lidos pela IA pelos da página e mantém o resto", () => {
    const draft = withPageItems(DRAFT, parseNfceItems(NATIONAL_PAGE));
    expect(draft.items).toHaveLength(3);
    expect(draft.items[0]).toEqual({ description: "CAFE 3 COR 250G TRAD V", quantity: 1, unit: "UN", unitPriceCents: 1798, totalCents: 1798 });
    expect(draft.items.every((i) => i.unitPriceCents !== null && i.totalCents > 0)).toBe(true);
    expect(draft).toMatchObject({ supplier: "MERCADO EXEMPLO LTDA", totalCents: 2780, paymentMethod: "debito" });
  });

  it("sem total lido, usa a soma dos itens; sem itens na página, fica com o da IA", () => {
    expect(withPageItems({ ...DRAFT, totalCents: null }, parseNfceItems(NATIONAL_PAGE)).totalCents).toBe(2780);
    expect(withPageItems(DRAFT, [])).toBe(DRAFT);
  });
});
