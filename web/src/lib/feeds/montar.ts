/**
 * Roda as receitas de um pacote de origem no DuckDB: carrega a entrada, monta as camadas e grava um Parquet
 * por tabela de molde em <saida>/<molde>/<tabela>.parquet.
 *
 * Entrada em duas camadas possíveis:
 *  - "oficial": as tabelas como o sistema exporta (nomes de coluna livres em maiúsculas/acentos); passam
 *    pelas receitas de staging e viram o modelo;
 *  - "modelo": as tabelas já tratadas (ex.: as extraídas de um .pbix), para conferir as receitas dos moldes
 *    contra o que está publicado sem depender do staging.
 * As receitas são código do repositório (revisado em PR), não entrada de usuário.
 */
import { mkdir } from "node:fs/promises";
import type { DuckDBConnection } from "@duckdb/node-api";
import { quotePath } from "../duck/engine";
import { DUCK_TYPE, normalizeName, quoteIdent } from "../ingest/contract";
import type { PacoteCarregado, PacoteColuna } from "./pacote";

export type Camada = "oficial" | "modelo";

export interface MontarOpcoes {
  camada: Camada;
  /** Tabela (oficial ou do modelo, conforme a camada) → arquivo Parquet. */
  arquivos: Readonly<Record<string, string>>;
  /** Pasta onde as saídas são gravadas. */
  saida: string;
  /** Data a que os dados se referem (AAAA-MM-DD): o "hoje" das colunas relativas (dias até o vencimento…). */
  dataReferencia: string;
  /** Só estes moldes (padrão: todos). */
  moldes?: readonly string[];
}

export interface TabelaMontada {
  molde: string;
  tabela: string;
  linhas: number;
  arquivo: string;
}

export class ErroDeCarga extends Error {}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Nome do schema DuckDB de um molde ("estoque-movimentacao" → "molde_estoque_movimentacao"). */
export function schemaDoMolde(molde: string): string {
  return `molde_${molde.replace(/-/g, "_")}`;
}

async function colunasDoArquivo(conn: DuckDBConnection, arquivo: string): Promise<string[]> {
  const reader = await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet(${quotePath(arquivo)})`);
  return reader.getRowObjectsJS().map((r) => String(r.column_name));
}

/**
 * Cria `tabela` com as colunas do contrato lidas do arquivo, convertidas ao tipo. As colunas do arquivo são
 * casadas pelo nome normalizado ("ClienteOdeon" → clienteodeon); colunas a mais são ignoradas.
 */
async function carregarTabela(
  conn: DuckDBConnection, tabela: string, colunas: readonly PacoteColuna[], arquivo: string | undefined,
): Promise<number> {
  if (!arquivo) throw new ErroDeCarga(`${tabela}: arquivo não enviado`);
  const doArquivo = new Map((await colunasDoArquivo(conn, arquivo)).map((c) => [normalizeName(c), c]));
  const faltam = colunas.filter((c) => !doArquivo.has(c.nome)).map((c) => c.nome);
  if (faltam.length > 0) throw new ErroDeCarga(`${tabela}: faltam as colunas ${faltam.join(", ")}`);

  const select = colunas
    .map((c) => `CAST(${quoteIdent(doArquivo.get(c.nome) as string)} AS ${DUCK_TYPE[c.tipo]}) AS ${c.nome}`)
    .join(", ");
  try {
    await conn.run(`CREATE TABLE ${tabela} AS SELECT ${select} FROM read_parquet(${quotePath(arquivo)})`);
  } catch (err) {
    throw new ErroDeCarga(`${tabela}: valores fora do tipo (${(err as Error).message.split("\n")[0]})`);
  }
  return conferirObrigatorias(conn, tabela, colunas);
}

/** Recusa vazio em coluna obrigatória; devolve o número de linhas. */
async function conferirObrigatorias(conn: DuckDBConnection, tabela: string, colunas: readonly PacoteColuna[]): Promise<number> {
  const obrig = colunas.filter((c) => c.obrigatoria);
  const contagens = obrig.map((c) => `COUNT(*) - COUNT(${c.nome}) AS ${c.nome}`);
  const reader = await conn.runAndReadAll(`SELECT COUNT(*) AS linhas${contagens.length ? `, ${contagens.join(", ")}` : ""} FROM ${tabela}`);
  const row = reader.getRowObjectsJS()[0];
  const vazias = obrig.filter((c) => Number(row[c.nome]) > 0).map((c) => `${c.nome} (${Number(row[c.nome])})`);
  if (vazias.length > 0) throw new ErroDeCarga(`${tabela}: vazio em coluna obrigatória: ${vazias.join(", ")}`);
  return Number(row.linhas);
}

/** Roda uma receita como CREATE TABLE e confere que entrega as colunas declaradas (quando declaradas). */
async function rodarReceita(conn: DuckDBConnection, destino: string, sql: string, rotulo: string): Promise<void> {
  try {
    await conn.run(`CREATE TABLE ${destino} AS ${sql}`);
  } catch (err) {
    throw new ErroDeCarga(`${rotulo}: ${(err as Error).message.split("\n")[0]}`);
  }
}

async function conferirColunas(conn: DuckDBConnection, tabela: string, colunas: readonly PacoteColuna[], rotulo: string): Promise<void> {
  const reader = await conn.runAndReadAll(`DESCRIBE ${tabela}`);
  const tem = new Set(reader.getRowObjectsJS().map((r) => String(r.column_name)));
  const faltam = colunas.filter((c) => !tem.has(c.nome)).map((c) => c.nome);
  if (faltam.length > 0) throw new ErroDeCarga(`${rotulo}: a receita não entrega ${faltam.join(", ")}`);
}

/** Monta as tabelas do modelo: lendo-as prontas (camada "modelo") ou pelas receitas de staging (camada "oficial"). */
async function montarModelo(conn: DuckDBConnection, p: PacoteCarregado, opcoes: MontarOpcoes): Promise<void> {
  if (opcoes.camada === "modelo") {
    for (const m of p.pacote.modelo) {
      if (opcoes.arquivos[m.nome]) await carregarTabela(conn, m.nome, m.colunas, opcoes.arquivos[m.nome]);
    }
    return;
  }
  for (const o of p.pacote.oficiais) await carregarTabela(conn, `o_${o.nome}`, o.colunas, opcoes.arquivos[o.nome]);
  for (const m of p.pacote.modelo) {
    const sql = p.staging[m.nome];
    if (!sql) throw new ErroDeCarga(`${m.nome}: falta a receita staging/${m.nome}.sql`);
    await rodarReceita(conn, m.nome, sql, `staging/${m.nome}`);
    await conferirColunas(conn, m.nome, m.colunas, `staging/${m.nome}`);
    await conferirObrigatorias(conn, m.nome, m.colunas);
  }
}

export async function montar(conn: DuckDBConnection, p: PacoteCarregado, opcoes: MontarOpcoes): Promise<TabelaMontada[]> {
  if (!DATA.test(opcoes.dataReferencia)) throw new ErroDeCarga("data de referência no formato AAAA-MM-DD");
  const moldes = p.pacote.saidas.filter((s) => !opcoes.moldes || opcoes.moldes.includes(s.molde));
  if (opcoes.moldes) {
    const desconhecidos = opcoes.moldes.filter((m) => !p.pacote.saidas.some((s) => s.molde === m));
    if (desconhecidos.length > 0) throw new ErroDeCarga(`molde fora do pacote: ${desconhecidos.join(", ")}`);
  }

  await conn.run(`SET VARIABLE data_referencia = DATE '${opcoes.dataReferencia}'`);
  await montarModelo(conn, p, opcoes);

  const feitas: TabelaMontada[] = [];
  for (const s of moldes) {
    const schema = schemaDoMolde(s.molde);
    await conn.run(`CREATE SCHEMA ${schema}`);
    // As receitas de um molde leem as tabelas anteriores dele pelo nome, e as do modelo (main).
    await conn.run(`SET search_path = '${schema},main'`);
    try {
      for (const t of s.tabelas) {
        await rodarReceita(conn, `${schema}.${t}`, p.moldes[s.molde][t], `moldes/${s.molde}/${t}`);
      }
    } finally {
      await conn.run("SET search_path = 'main'");
    }
    const pasta = `${opcoes.saida.replace(/[\\/]+$/, "")}/${s.molde}`;
    await mkdir(pasta, { recursive: true });
    for (const t of s.tabelas) {
      const arquivo = `${pasta}/${t}.parquet`;
      await conn.run(`COPY ${schema}.${t} TO ${quotePath(arquivo)} (FORMAT parquet)`);
      const reader = await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM ${schema}.${t}`);
      feitas.push({ molde: s.molde, tabela: t, linhas: Number(reader.getRowObjectsJS()[0].n), arquivo });
    }
  }
  return feitas;
}
