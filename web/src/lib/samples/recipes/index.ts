/** Hand-written recipes by template id. A template without one gets fully generic sample data. */
import type { Recipe } from "../types";
import { entradasDeMercadorias, posicaoDeEstoque } from "./estoque";
import { contasAPagar, contasAReceber } from "./financeiro";
import { vendasExecutivo, vendasFiliaisProdutos } from "./vendas";

const RECIPES: Readonly<Record<string, Recipe>> = {
  "vendas-executivo": vendasExecutivo,
  "vendas-filiais-produtos": vendasFiliaisProdutos,
  "contas-a-receber": contasAReceber,
  "contas-a-pagar": contasAPagar,
  "posicao-de-estoque": posicaoDeEstoque,
  "entradas-de-mercadorias": entradasDeMercadorias,
};

export function recipeFor(templateId: string): Recipe | undefined {
  return Object.hasOwn(RECIPES, templateId) ? RECIPES[templateId] : undefined;
}
