/**
 * Pacote de origem: o contrato das tabelas oficiais de um sistema (o ERP de onde os clientes exportam) e
 * as receitas SQL que as transformam nas tabelas dos moldes. Vive em web/feeds/<pacote>/ (sem dado de cliente):
 *
 *   pacote.json                    oficiais (o que chega), modelo (o que o tratamento entrega), saidas (por molde)
 *   staging/<tabela do modelo>.sql uma consulta por tabela do modelo, lendo as oficiais (o_<nome>)
 *   moldes/<molde>/<tabela>.sql    uma consulta por tabela do molde, lendo as do modelo
 *
 * Camadas: oficial → modelo (o Power Query traduzido) → molde (contrato do dashboard, DAX das colunas calculadas).
 * Ver docs/ingestao-diaria.md.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { COLUMN_TYPES } from "../templates/schema";

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = z.string().regex(IDENT, "use snake_case");

const columnSchema = z.object({
  nome: ident,
  tipo: z.enum(COLUMN_TYPES),
  /** Nunca vem vazia (a carga recusa o lote se vier). */
  obrigatoria: z.boolean().default(false),
});
export type PacoteColuna = z.infer<typeof columnSchema>;

const oficialSchema = z.object({
  nome: ident,
  /** Onde a tabela nasce no sistema de origem (ex.: "dbo.Vendas"). Só documentação. */
  origem: z.string().min(1),
  carga: z.enum(["completa"]).default("completa"),
  descricao: z.string().default(""),
  colunas: z.array(columnSchema).min(1),
});
export type Oficial = z.infer<typeof oficialSchema>;

const modeloSchema = z.object({
  nome: ident,
  descricao: z.string().default(""),
  colunas: z.array(columnSchema).min(1),
});
export type TabelaModelo = z.infer<typeof modeloSchema>;

const saidaSchema = z.object({
  molde: z.string().regex(/^[a-z0-9-]+$/),
  /** Tabelas do molde, na ordem em que são montadas (uma pode ler as anteriores do mesmo molde). */
  tabelas: z.array(ident).min(1),
});

export const pacoteSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    nome: z.string().min(1),
    descricao: z.string().default(""),
    oficiais: z.array(oficialSchema),
    modelo: z.array(modeloSchema).min(1),
    saidas: z.array(saidaSchema).min(1),
  })
  .superRefine((p, ctx) => {
    const dup = (names: string[], what: string): void => {
      const seen = new Set<string>();
      for (const n of names) {
        if (seen.has(n)) ctx.addIssue({ code: "custom", message: `${what} repetida: ${n}` });
        seen.add(n);
      }
    };
    dup(p.oficiais.map((o) => o.nome), "tabela oficial");
    dup(p.modelo.map((m) => m.nome), "tabela do modelo");
    dup(p.saidas.map((s) => s.molde), "molde");
    for (const t of [...p.oficiais, ...p.modelo]) dup(t.colunas.map((c) => c.nome), `coluna de ${t.nome}`);
  });
export type Pacote = z.infer<typeof pacoteSchema>;

export interface PacoteCarregado {
  pacote: Pacote;
  /** Receita de cada tabela do modelo que já tem uma (tabela do modelo → SQL). */
  staging: Readonly<Record<string, string>>;
  /** molde → tabela → SQL. */
  moldes: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Uma receita é uma única consulta: sem ponto e vírgula fora do fim (nada de comandos encadeados). */
export function limparReceita(sql: string, origem: string): string {
  const semComentarios = sql.replace(/--[^\n]*/g, "").trim().replace(/;\s*$/, "");
  if (semComentarios.length === 0) throw new Error(`${origem}: receita vazia`);
  if (semComentarios.includes(";")) throw new Error(`${origem}: uma receita é uma consulta só (sem ';' no meio)`);
  if (!/^(with|select)\b/i.test(semComentarios)) throw new Error(`${origem}: a receita começa com SELECT ou WITH`);
  return semComentarios;
}

function lerReceita(arquivo: string): string | null {
  return existsSync(arquivo) ? limparReceita(readFileSync(arquivo, "utf8"), arquivo) : null;
}

/**
 * Lê e valida um pacote. Toda tabela de saída dos moldes pedidos (padrão: todos) precisa de receita; a do
 * modelo pode faltar (só a camada oficial a exige).
 */
export function carregarPacote(dir: string, moldes?: readonly string[]): PacoteCarregado {
  const lido = pacoteSchema.parse(JSON.parse(readFileSync(path.join(dir, "pacote.json"), "utf8")));
  const desconhecidos = (moldes ?? []).filter((m) => !lido.saidas.some((s) => s.molde === m));
  if (desconhecidos.length > 0) throw new Error(`molde fora do pacote: ${desconhecidos.join(", ")}`);
  const pacote = moldes && moldes.length > 0 ? { ...lido, saidas: lido.saidas.filter((s) => moldes.includes(s.molde)) } : lido;
  const staging: Record<string, string> = {};
  for (const m of pacote.modelo) {
    const sql = lerReceita(path.join(dir, "staging", `${m.nome}.sql`));
    if (sql) staging[m.nome] = sql;
  }
  const receitas: Record<string, Record<string, string>> = {};
  for (const s of pacote.saidas) {
    receitas[s.molde] = {};
    for (const t of s.tabelas) {
      const sql = lerReceita(path.join(dir, "moldes", s.molde, `${t}.sql`));
      if (!sql) throw new Error(`falta a receita moldes/${s.molde}/${t}.sql`);
      receitas[s.molde][t] = sql;
    }
  }
  return { pacote, staging, moldes: receitas };
}
