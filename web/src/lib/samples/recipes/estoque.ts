/** Stock templates: a monthly position of every item in every branch, and the purchase notes. */
import { between, indexOf, money, u, uBy, weighted } from "../sql";
import type { Recipe, Stages } from "../types";
import { PRODUCT_COUNT } from "../vocab";

const BRANCHES = 8;
const MONTHS = 6;
const PER_MONTH = BRANCHES * PRODUCT_COUNT;
const cost = (seed: string): string => money(between(8, 600, uBy(seed, "custo"), 2));

const POSITION_STAGES: Stages = [{ it: `((i // ${BRANCHES}) % ${PRODUCT_COUNT})`, mth: `(i // ${PER_MONTH})` }, { cst: cost("it") }];

export const posicaoDeEstoque: Recipe = {
  rows: { filiais: BRANCHES, item: PRODUCT_COUNT, estoque: PER_MONTH * MONTHS },
  tables: (ctx) => ({
    estoque: {
      stages: POSITION_STAGES,
      columns: {
        filial: ctx.key("filiais", `i % ${BRANCHES}`),
        item: ctx.key("item", "it"),
        dataposicaoestoque: `(CAST(${ctx.anchor} - to_months(CAST(mth AS INTEGER)) AS DATE) - 1)`,
        qtde_fisico: `(${indexOf(u("q"), 120, 2)} - 3)`,
        ultimovalorunitarioentrada: "cst",
        precovenda: money("cst * 1.45"),
      },
    },
  }),
};

export const entradasDeMercadorias: Recipe = {
  rows: { entradas: 12000 },
  tables: (ctx) => ({
    entradas: {
      stages: [{ nota: "(i // 4)" }],
      seedBy: { filial: "nota", fornecedor: "nota", dataentrada: "nota" },
      columns: {
        tipoentrada: weighted([["'E'", 0.82], ["'D'", 0.06], ["'T'", 0.12]], uBy("nota", "tp")),
        nrnota: "CAST(30000 + nota AS VARCHAR)",
        item: ctx.key("item", "p"),
        qtde: `(1 + ${indexOf(u("q"), 60, 2)})`,
        custoultimaentrada: cost("p"),
      },
    },
  }),
};
