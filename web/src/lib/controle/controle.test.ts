import { describe, expect, it } from "vitest";
import { toDraft, type ReceiptReading } from "./extraction";
import { isReceiptPath, receiptExt, receiptMime, receiptPath } from "./receipts";
import { isValidDay, monthLabel, monthOrCurrent, purchaseInput, saleInput, shiftDay, shiftMonth, todayInBrazil } from "./schema";
import { cumulative } from "./series";

const TODAY = new Date("2026-11-11T15:00:00Z");
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("datas", () => {
  it("aceita só dias que existem, de 2000 até hoje", () => {
    expect(isValidDay("2026-11-11", TODAY)).toBe(true);
    expect(isValidDay("2026-02-30", TODAY)).toBe(false);
    expect(isValidDay("1999-12-31", TODAY)).toBe(false);
    expect(isValidDay("2026-11-12", TODAY)).toBe(false);
    expect(isValidDay("11/11/2026", TODAY)).toBe(false);
  });

  it("quantidade menor que um milésimo é recusada (viraria zero no banco)", () => {
    const purchase = { purchasedOn: "2026-11-10", totalCents: 100 };
    const item = { description: "x", totalCents: 100 };
    expect(purchaseInput.safeParse({ ...purchase, items: [{ ...item, quantity: 0.0004 }] }).success).toBe(false);
    expect(purchaseInput.safeParse({ ...purchase, items: [{ ...item, quantity: 0.001 }] }).success).toBe(true);
  });

  it("dia anterior e seguinte", () => {
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("o dia de hoje é o do Brasil, não o do servidor", () => {
    expect(todayInBrazil(new Date("2026-11-12T01:30:00Z"))).toBe("2026-11-11");
  });

  it("mês da tela", () => {
    expect(monthOrCurrent("2026-03", TODAY)).toBe("2026-03");
    expect(monthOrCurrent("2026-13", TODAY)).toBe("2026-11");
    expect(monthOrCurrent(undefined, TODAY)).toBe("2026-11");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2026-11")).toBe("novembro de 2026");
  });
});

describe("comprovantes", () => {
  it("só aceita foto e PDF", () => {
    expect(receiptExt("image/jpeg")).toBe("jpg");
    expect(receiptExt("application/pdf")).toBe("pdf");
    expect(receiptExt("image/heic")).toBeNull();
    expect(receiptExt("text/html")).toBeNull();
  });

  it("o caminho fica dentro de controle/comprovantes e não pode ser forjado", () => {
    const path = receiptPath("2026-11", ID, "jpg");
    expect(path).toBe(`controle/comprovantes/2026-11/${ID}.jpg`);
    expect(isReceiptPath(path)).toBe(true);
    expect(receiptMime(path)).toBe("image/jpeg");
    expect(isReceiptPath(`controle/comprovantes/2026-11/../../outro/${ID}.jpg`)).toBe(false);
    expect(isReceiptPath(`fiscal/2026-11/${ID}.jpg`)).toBe(false);
    expect(isReceiptPath(`controle/comprovantes/2026-11/${ID}.html`)).toBe(false);
    expect(receiptMime("qualquer/coisa.pdf")).toBeNull();
    expect(() => receiptPath("2026-13", ID, "jpg")).toThrow();
  });
});

const reading = (over: Partial<ReceiptReading>): ReceiptReading => ({
  comprovante_legivel: true,
  fornecedor: "Atacadão",
  data: "2026-11-10",
  total: 57.48,
  forma_pagamento: "pix",
  itens: [
    { descricao: "LEITE COND 395G", quantidade: 6, unidade: "un", valor_unitario: 6.99, valor_total: 41.94 },
    { descricao: "CHOC PO 200G", quantidade: 2, unidade: "un", valor_unitario: 7.77, valor_total: 15.54 },
  ],
  observacao: null,
  ...over,
});

describe("leitura do comprovante → rascunho", () => {
  it("converte reais em centavos e mantém o que foi lido", () => {
    const draft = toDraft(reading({}), TODAY);
    expect(draft).toMatchObject({ readable: true, supplier: "Atacadão", purchasedOn: "2026-11-10", totalCents: 5748, paymentMethod: "pix" });
    expect(draft.items).toEqual([
      { description: "LEITE COND 395G", quantity: 6, unit: "un", unitPriceCents: 699, totalCents: 4194 },
      { description: "CHOC PO 200G", quantity: 2, unit: "un", unitPriceCents: 777, totalCents: 1554 },
    ]);
  });

  it("sem total no papel, parte da soma das linhas", () => {
    expect(toDraft(reading({ total: null }), TODAY).totalCents).toBe(5748);
    expect(toDraft(reading({ total: null, itens: [] }), TODAY).totalCents).toBeNull();
  });

  it("descarta o que é impossível em vez de inventar", () => {
    const draft = toDraft(
      reading({
        data: "2026-02-31",
        fornecedor: "   ",
        itens: [
          { descricao: "  ", quantidade: 1, unidade: null, valor_unitario: 1, valor_total: 1 },
          { descricao: "Granulado", quantidade: -3, unidade: null, valor_unitario: null, valor_total: 9.9 },
          { descricao: "Sem valor", quantidade: 1, unidade: null, valor_unitario: null, valor_total: Number.NaN },
        ],
      }),
      TODAY,
    );
    expect(draft.purchasedOn).toBeNull();
    expect(draft.supplier).toBeNull();
    expect(draft.items).toEqual([{ description: "Granulado", quantity: 1, unit: null, unitPriceCents: null, totalCents: 990 }]);
  });
});

describe("o que chega da tela", () => {
  const purchase = {
    purchasedOn: "2026-11-10", totalCents: 5748,
    items: [{ description: "Leite condensado", quantity: 6, totalCents: 4194 }],
  };

  it("compra: campos opcionais viram null", () => {
    const parsed = purchaseInput.parse({ ...purchase, supplier: "  ", notes: "" });
    expect(parsed).toMatchObject({ supplier: null, notes: null, paymentMethod: null, receipt: null, fromReceipt: false });
    expect(parsed.items[0]).toMatchObject({ unit: null, unitPriceCents: null });
  });

  it.each([
    { ...purchase, purchasedOn: "10/11/2026" },
    { ...purchase, totalCents: -1 },
    { ...purchase, totalCents: 12.5 },
    { ...purchase, paymentMethod: "cheque" },
    { ...purchase, items: [{ description: "", quantity: 1, totalCents: 1 }] },
    { ...purchase, items: [{ description: "x", quantity: 0, totalCents: 1 }] },
  ])("compra inválida é recusada (%#)", (input) => expect(purchaseInput.safeParse(input).success).toBe(false));

  it("venda: valor, pagamento e data; o nome do cliente é opcional", () => {
    const sale = { soldOn: "2026-11-11", totalCents: 17500, paymentMethod: "pix" };
    expect(saleInput.parse(sale)).toEqual({ soldOn: "2026-11-11", totalCents: 17500, paymentMethod: "pix", customerName: null });
    expect(saleInput.parse({ ...sale, customerName: "  Dona Lúcia " }).customerName).toBe("Dona Lúcia");
    expect(saleInput.parse({ ...sale, customerName: "  " }).customerName).toBeNull();
    expect(saleInput.safeParse({ ...sale, totalCents: 0 }).success).toBe(false);
    expect(saleInput.safeParse({ ...sale, soldOn: "2999-01-01" }).success).toBe(false);
  });
});

describe("evolução", () => {
  const days = [
    { period: "2026-11-01", salesCents: 100, purchasesCents: 0 },
    { period: "2026-11-02", salesCents: 0, purchasesCents: 40 },
    { period: "2026-11-03", salesCents: 50, purchasesCents: 10 },
    { period: "2026-11-04", salesCents: 0, purchasesCents: 0 },
  ];

  it("acumula dia a dia", () => {
    expect(cumulative(days, "2026-11-30")).toEqual([
      { period: "2026-11-01", salesCents: 100, purchasesCents: 0 },
      { period: "2026-11-02", salesCents: 100, purchasesCents: 40 },
      { period: "2026-11-03", salesCents: 150, purchasesCents: 50 },
      { period: "2026-11-04", salesCents: 150, purchasesCents: 50 },
    ]);
  });

  it("não desenha os dias que ainda não chegaram", () => {
    const upTo = cumulative(days, "2026-11-02");
    expect(upTo.slice(0, 2).map((p) => p.salesCents)).toEqual([100, 100]);
    expect(upTo.slice(2)).toEqual([
      { period: "2026-11-03", salesCents: null, purchasesCents: null },
      { period: "2026-11-04", salesCents: null, purchasesCents: null },
    ]);
  });
});
