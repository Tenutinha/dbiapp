/** Sales templates: a sale has several items, and its values follow quantity × price − discount. */
import { between, indexOf, money, pickAt, u, uBy } from "../sql";
import type { Recipe, Stages } from "../types";

const price = (lo: number, hi: number): string => money(between(lo, hi, uBy("p", "preco"), 2));

const SALE_STAGES: Stages = [
  { q: `(1 + ${indexOf(u("q"), 4, 2)})`, preco: price(40, 2440), dpct: `(${u("d")} * 0.15)` },
  { bruto: money("q * preco") },
  { dsc: money("bruto * dpct") },
  { liq: "round(bruto - dsc, 2)" },
];

export const vendasExecutivo: Recipe = {
  rows: { fato_vendas: 20000 },
  tables: (ctx) => ({
    fato_vendas: {
      stages: SALE_STAGES,
      columns: {
        id_venda: "(i + 1)",
        id_produto: ctx.key("dim_produto", "p"),
        quantidade: "q",
        valor_bruto: "bruto",
        desconto: "dsc",
        valor_liquido: "liq",
        custo: money(`liq * (0.45 + 0.30 * ${u("c")})`),
      },
    },
  }),
};

const PLANS = ["À vista", "30 dias", "30/60 dias", "30/60/90 dias", "Cartão de crédito", "Cartão de débito", "Pix", "Boleto 28 dias"];
const PLAN_KINDS = ["Dinheiro", "Boleto", "Boleto", "Boleto", "Cartão", "Cartão", "Pix", "Boleto"];
const CREDIT_AGE = ["Até 30 dias", "31 a 60 dias", "61 a 90 dias", "Acima de 90 dias"];
const DESTINATIONS = ["Revenda", "Consumo próprio", "Uso e consumo"];
const SALE_SEEDED = ["filial", "data", "cliente", "plano_pagamento", "vendedor"] as const;

const ITEM_STAGES: Stages = [
  { sale: "(i // 3)" },
  {
    tp: `CASE WHEN ${uBy("sale", "tp")} < 0.04 THEN 'D' ELSE 'V' END`,
    q: `(1 + ${indexOf(u("q"), 6, 2)})`,
    preco: price(15, 1800),
    dpct: `(${u("d")} * 0.12)`,
  },
  { val: money("q * preco * (1 - dpct)") },
];

export const vendasFiliaisProdutos: Recipe = {
  rows: { vendas: 30000, planopagamento: PLANS.length },
  tables: (ctx) => ({
    vendas: {
      stages: ITEM_STAGES,
      seedBy: Object.fromEntries(SALE_SEEDED.map((column) => [column, "sale"])),
      columns: {
        tipo: "tp",
        nrsaida: "CAST(100000 + sale AS VARCHAR)",
        item: ctx.key("item", "p"),
        qtde: "q",
        desconto: `CASE WHEN tp = 'V' THEN ${money("q * preco * dpct")} ELSE 0 END`,
        vlrliquido: "CASE WHEN tp = 'D' THEN -val ELSE val END",
        vlrliquido_antigo: "val",
        vlrcue: money(`val * (0.62 + 0.16 * ${u("c")})`),
        destino_compra: pickAt(DESTINATIONS, indexOf(uBy("sale", "dest"), DESTINATIONS.length, 2)),
      },
    },
    dcalendario: { columns: { ano: `CAST(year(${ctx.key("dcalendario", "i")}) AS VARCHAR)` } },
    filiais: { columns: { descricaogrupo: pickAt(["Rede Norte", "Rede Sul", "Rede Centro"], "i") } },
    planopagamento: { columns: { descricaoplano: pickAt(PLANS, "i"), descricaomodalidade: pickAt(PLAN_KINDS, "i") } },
    clientes: { columns: { classe_cliente_dias: pickAt(CREDIT_AGE, indexOf(u("dias"), CREDIT_AGE.length, 2)) } },
  }),
};
