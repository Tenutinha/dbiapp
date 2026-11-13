import { describe, expect, it } from "vitest";
import { describeKey, formatCnpj, isValidKey, keyCheckDigit, pageText, parseNfceQr } from "./nfce";

// PR, nov/2026, CNPJ 12.345.678/0001-90, modelo 65, série 1, número 12345 — dígito verificador calculado.
const KEY = "41261112345678000190650010000123451000123456";
// Mesma coisa em modelo 55 (NF-e, não é cupom de consumidor).
const NFE_KEY = "35261112345678000190550010000000011000000016";

describe("chave de acesso", () => {
  it("confere o dígito verificador", () => {
    expect(keyCheckDigit(KEY.slice(0, 43))).toBe(6);
    expect(isValidKey(KEY)).toBe(true);
    expect(isValidKey(`${KEY.slice(0, 43)}7`)).toBe(false);
    expect(isValidKey(KEY.slice(1))).toBe(false);
  });

  it("separa estado, mês, CNPJ, modelo, série e número", () => {
    expect(describeKey(KEY)).toEqual({ uf: "41", month: "2026-11", cnpj: "12345678000190", model: "65", series: "001", number: "12345" });
    expect(formatCnpj("12345678000190")).toBe("12.345.678/0001-90");
  });
});

describe("QR Code da NFC-e", () => {
  it("lê a versão 2 (p=chave|…) e a versão 1 (chNFe=)", () => {
    expect(parseNfceQr(`http://www.fazenda.pr.gov.br/nfce/qrcode?p=${KEY}|2|1|1|ABCDEF0123`)).toEqual({
      url: `http://www.fazenda.pr.gov.br/nfce/qrcode?p=${KEY}|2|1|1|ABCDEF0123`,
      key: KEY,
    });
    expect(parseNfceQr(` https://nfce.fazenda.sp.gov.br/qrcode?chNFe=${KEY}&nVersao=100&tpAmb=1 `)?.key).toBe(KEY);
    expect(parseNfceQr(`https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx?p=${KEY}%7C2%7C1%7C1%7CXYZ`)?.key).toBe(KEY);
  });

  it("recusa o que não é NFC-e de uma SEFAZ (e nunca busca endereço de fora)", () => {
    expect(parseNfceQr(`https://golpe.com/qrcode?p=${KEY}|2|1|1|X`)).toBeNull();
    expect(parseNfceQr(`https://fazenda.pr.gov.br.golpe.com/?p=${KEY}`)).toBeNull();
    expect(parseNfceQr(`https://www.fazenda.pr.gov.br:8443/?p=${KEY}`)).toBeNull();
    expect(parseNfceQr(`https://user:x@www.fazenda.pr.gov.br/?p=${KEY}`)).toBeNull();
    expect(parseNfceQr(`ftp://www.fazenda.pr.gov.br/?p=${KEY}`)).toBeNull();
    expect(parseNfceQr(`https://www.fazenda.pr.gov.br/?p=${KEY.slice(0, 43)}7`)).toBeNull();
    expect(parseNfceQr(`https://www.fazenda.sp.gov.br/?p=${NFE_KEY}`)).toBeNull();
    expect(parseNfceQr("PIX 00020126...")).toBeNull();
  });
});

describe("texto da página da SEFAZ", () => {
  it("tira scripts e marcação, separa células e decodifica entidades", () => {
    const html = `<html><head><style>.x{}</style><script>alert(1)</script></head><body>
      <div>SUPERMERCADO BOM PRE&Ccedil;O LTDA</div><div>CNPJ: 12.345.678/0001-90</div>
      <table><tr><td>LEITE COND 395G</td><td>Qtde.:6</td><td>Vl. Total&nbsp;41,94</td></tr>
      <tr><td>CHOC PO&#32;200G</td><td>Qtde.:2</td><td>Vl. Total 15,54</td></tr></table>
      <!-- comentário --><p>Valor a pagar R$: 57,48</p></body></html>`;
    const text = pageText(html);
    expect(text).not.toMatch(/alert|\.x\{|comentário|<|>/);
    expect(text).toContain("LEITE COND 395G | Qtde.:6 | Vl. Total 41,94");
    expect(text).toContain("CHOC PO 200G");
    expect(text).toContain("Valor a pagar R$: 57,48");
    expect(pageText("<p>a</p>".repeat(10), 5)).toHaveLength(5);
    expect(pageText("P&Atilde;O FRANC&Ecirc;S &ccedil;&eacute; N&ordm; &AMP;")).toBe("PÃO FRANCÊS çé Nº &");
  });
});
