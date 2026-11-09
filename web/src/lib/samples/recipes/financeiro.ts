/**
 * Receivables and payables: a title's issue date, due date, settlement and status must agree with
 * each other and with "today" (the anchor), otherwise aging and delinquency visuals show nonsense.
 */
import { between, indexOf, lit, money, pickAt, u, weighted } from "../sql";
import type { Recipe, TableRecipe } from "../types";

interface StatusNames {
  onTime: string;
  late: string;
}

interface PastShares {
  onTime: number;
  late: number;
  /** Share of titles not yet due that were settled in advance. */
  early: number;
}

const OVERDUE = "Atrasado";
const PLANNED = "Previsto";

/** Stages shared by both sides: emissao → venc → st/dd → pago/quitacao. */
function titleStages(anchor: string, names: StatusNames, shares: PastShares): NonNullable<TableRecipe["stages"]> {
  const onTime = lit(names.onTime);
  const late = lit(names.late);
  const past = `CASE WHEN r < ${shares.onTime} THEN ${onTime} WHEN r < ${shares.onTime + shares.late} THEN ${late} ELSE ${lit(OVERDUE)} END`;
  const future = `CASE WHEN r < ${shares.early} THEN ${onTime} ELSE ${lit(PLANNED)} END`;
  return [
    {
      em_off: indexOf(u("em"), 200),
      prazo: `(7 * (1 + ${indexOf(u("pz"), 9)}))`,
      valor: money(between(80, 6000, u("val"), 2)),
      r: u("r"),
      r2: u("r2"),
    },
    { emissao: `(${anchor} - 1 - CAST(em_off AS INTEGER))` },
    { venc: "(emissao + CAST(prazo AS INTEGER))" },
    { st: `CASE WHEN venc < ${anchor} - 1 THEN ${past} ELSE ${future} END`, dd: `datediff('day', ${anchor}, venc)` },
    {
      pago: `(st IN (${onTime}, ${late}))`,
      quitacao: `CASE WHEN st = ${onTime} THEN greatest(emissao, least(venc - CAST(floor(r2 * 5) AS INTEGER), ${anchor} - 1))
        WHEN st = ${late} THEN least(venc + 1 + CAST(floor(r2 * 25) AS INTEGER), ${anchor} - 1) END`,
    },
  ];
}

const titleNumber = { nrtitulo: "CAST(50000 + i // 2 AS VARCHAR)", parcela: "CAST(1 + i % 2 AS VARCHAR)" };

const RECEIVED: StatusNames = { onTime: "Recebido em dia", late: "Recebido com atraso" };
const RECEIVABLE_KINDS = ["Boleto", "Cartão de crédito", "Cartão de débito", "Pix", "Cheque", "Carteira"];
const CAN_BE_LATE = ["S", "N", "N", "N", "S", "S"];
const REVENUE_ORIGINS = ["Venda balcão", "Venda online", "Venda faturada", "Serviços", "Renegociação", "Outras receitas"];
const REVENUE_GROUPS = ["Vendas", "Vendas", "Vendas", "Serviços", "Financeiro", "Outros"];
const CARDS = ["Visa Crédito", "Visa Débito", "Mastercard Crédito", "Mastercard Débito", "Elo Crédito", "Elo Débito"];

export const contasAReceber: Recipe = {
  rows: { titulosreceber: 9000 },
  tables: ({ anchor }) => ({
    titulosreceber: {
      stages: titleStages(anchor, RECEIVED, { onTime: 0.7, late: 0.18, early: 0.12 }),
      columns: {
        ...titleNumber,
        dtemissao: "emissao",
        dtvencimento: "venc",
        dtrecebimento: "quitacao",
        vlrtitulo_rateado: "valor",
        vlrsaldo_rateado: "CASE WHEN pago THEN 0 ELSE valor END",
        vlrrecebido: "CASE WHEN pago THEN valor END",
        vlrjuros: `CASE WHEN st = ${lit(RECEIVED.late)} THEN ${money("valor * 0.02")} ELSE 0 END`,
        vlrmulta: `CASE WHEN st = ${lit(RECEIVED.late)} THEN ${money("valor * 0.01")} ELSE 0 END`,
        analise_status: "st",
        dias_ate_vencimento: "dd",
        dias_ate_o_vencimento_2: "CASE WHEN dd >= 0 THEN 'Em ' || CAST(7 * (1 + dd // 7) AS VARCHAR) || ' dias' ELSE 'Vencido' END",
        vendaprazo: weighted([["'S'", 0.9], ["'N'", 0.1]], u("prazo")),
      },
    },
    modalidades: { columns: { modalidade_descricao: pickAt(RECEIVABLE_KINDS, "i"), pode_atrasar: pickAt(CAN_BE_LATE, "i") } },
    origens: { columns: { origem_descricao: pickAt(REVENUE_ORIGINS, "i"), origem_grupo: pickAt(REVENUE_GROUPS, "i") } },
    cartao: { columns: { cartao_descricao: pickAt(CARDS, "i") } },
  }),
};

const PAID: StatusNames = { onTime: "Pago em dia", late: "Pago com atraso" };
const AGING_STATUS = ["Quitado", "Vencido", "Vencido", "Vencido", "Vencido", "À Vencer", "À Vencer", "À Vencer", "À Vencer"];
const AGING_NAMES = [
  "Quitado", "Vencido >30 dias", "Vencido 16-30 dias", "Vencido 8-15 dias", "Vencido 1-7 dias",
  "À Vencer 1-7 dias", "À Vencer 8-15 dias", "À Vencer 16-30 dias", "À Vencer >30 dias",
];
const AGING_ORDER = `CASE WHEN pago THEN 1 WHEN dd < -30 THEN 2 WHEN dd < -15 THEN 3 WHEN dd < -7 THEN 4 WHEN dd < 0 THEN 5
  WHEN dd <= 6 THEN 6 WHEN dd <= 14 THEN 7 WHEN dd <= 29 THEN 8 ELSE 9 END`;
const EXPENSE_ORIGINS = ["Compra de mercadorias", "Folha de pagamento", "Impostos e taxas", "Aluguel", "Serviços de terceiros", "Energia e telecom"];
const EXPENSE_GROUPS = ["Mercadorias", "Pessoal", "Tributos", "Ocupação", "Serviços", "Ocupação"];
const PAYABLE_KINDS = ["Boleto", "Transferência", "Pix", "Débito automático", "Cheque", "Dinheiro"];
const PAID_FROM = `CASE po WHEN 'Caixa' THEN 'Caixa Tesouraria' WHEN 'Banco' THEN 'Banco 001 C/C 12345-6' ELSE 'Outros' END`;

export const contasAPagar: Recipe = {
  rows: { titulospagar: 8000 },
  tables: (ctx) => ({
    titulospagar: {
      stages: [
        ...titleStages(ctx.anchor, PAID, { onTime: 0.66, late: 0.18, early: 0.1 }),
        {
          fo: AGING_ORDER,
          jr: `CASE WHEN st = ${lit(PAID.late)} THEN ${money("valor * 0.02")} ELSE 0 END`,
          mt: `CASE WHEN st = ${lit(PAID.late)} THEN ${money("valor * 0.01")} ELSE 0 END`,
          ds: `CASE WHEN st = ${lit(PAID.onTime)} AND r2 < 0.2 THEN ${money("valor * 0.03")} ELSE 0 END`,
          po: weighted([["'Banco'", 0.6], ["'Caixa'", 0.25], ["'Outros'", 0.15]], u("po")),
        },
      ],
      columns: {
        ...titleNumber,
        dtemissao: "emissao",
        dtvencimento: "venc",
        dtpagamento: "quitacao",
        vlrtitulo: "valor",
        vlrpagamento: "CASE WHEN pago THEN round(valor + jr + mt - ds, 2) END",
        vlrsaldo: "CASE WHEN pago THEN 0 ELSE valor END",
        juros: "jr",
        multa: "mt",
        desconto: "ds",
        vlrjurosdiario: money("valor * 0.00033"),
        vlrmulta: `CASE WHEN st = 'Atrasado' THEN ${money("valor * 0.02")} ELSE 0 END`,
        analise_status: "st",
        faixa_vencimento_status: pickAt(AGING_STATUS, "fo - 1"),
        faixa_vencimento_ordem: "fo",
        faixa_vencimento_nome: pickAt(AGING_NAMES, "fo - 1"),
        chave_filial_pagamento: ctx.anyKey("filiais", "filpag"),
        pagamento_origem: "CASE WHEN pago THEN po END",
        modalidade_pagamento: `CASE WHEN pago THEN ${PAID_FROM} END`,
      },
    },
    origens: { columns: { origem_descricao: pickAt(EXPENSE_ORIGINS, "i"), origem_grupo: pickAt(EXPENSE_GROUPS, "i") } },
    modalidades: { columns: { modalidade_descricao: pickAt(PAYABLE_KINDS, "i") } },
  }),
};
