/**
 * Pacote de origem: oficiais → modelo (staging) → moldes, num DuckDB real, com um pacote e dados de mentira.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { beforeAll, describe, expect, it } from "vitest";
import { toDuckPath } from "../duck/engine";
import { ErroDeCarga, montar } from "./montar";
import { carregarPacote, limparReceita, pacoteSchema } from "./pacote";

let root = "";
const arq = (f: string): string => toDuckPath(path.join(root, "entrada", f));

const PACOTE = {
  id: "erp-teste",
  nome: "ERP de teste",
  oficiais: [
    {
      nome: "vendas", origem: "dbo.Vendas",
      colunas: [
        { nome: "nrsaida", tipo: "text", obrigatoria: true },
        { nome: "data", tipo: "date", obrigatoria: true },
        { nome: "vlrliquido", tipo: "decimal" },
        { nome: "cliente", tipo: "text" },
      ],
    },
    { nome: "clientes", origem: "dbo.Clientes", colunas: [{ nome: "cliente", tipo: "text", obrigatoria: true }, { nome: "uf", tipo: "text" }] },
  ],
  modelo: [
    { nome: "vendas", colunas: [{ nome: "nrsaida", tipo: "text" }, { nome: "data", tipo: "date" }, { nome: "vlrliquido", tipo: "decimal" }, { nome: "cliente", tipo: "text" }] },
    { nome: "clientes", colunas: [{ nome: "cliente", tipo: "text" }, { nome: "uf", tipo: "text" }] },
  ],
  saidas: [{ molde: "vendas-teste", tabelas: ["clientes", "vendas"] }],
};

async function escrever(rel: string, conteudo: string): Promise<void> {
  const f = path.join(root, "pacote", rel);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, conteudo, "utf8");
}

async function conexao(): Promise<DuckDBConnection> {
  return (await DuckDBInstance.create(":memory:")).connect();
}

async function linhas(conn: DuckDBConnection, sql: string): Promise<Record<string, unknown>[]> {
  return (await conn.runAndReadAll(sql)).getRowObjectsJS() as Record<string, unknown>[];
}

beforeAll(async () => {
  root = toDuckPath(await mkdtemp(path.join(os.tmpdir(), "dbi-feeds-")));
  await mkdir(path.join(root, "entrada"), { recursive: true });
  await escrever("pacote.json", JSON.stringify(PACOTE));
  // Staging: troca vazio por "NÃO CADASTRADO" (o Table.ReplaceValue do Power Query).
  await escrever("staging/clientes.sql", "-- cadastro\nSELECT cliente, COALESCE(uf, 'NÃO CADASTRADO') AS uf FROM o_clientes;");
  await escrever("staging/vendas.sql", "SELECT * FROM o_vendas");
  // Molde: classe calculada no fim (coluna DAX) e a fato lendo a dimensão anterior do mesmo molde.
  await escrever("moldes/vendas-teste/clientes.sql", `
    SELECT c.cliente, c.uf, CASE WHEN SUM(v.vlrliquido) >= 100 THEN 'Gold' ELSE 'Bronze' END AS classe
    FROM clientes c LEFT JOIN vendas v USING (cliente) GROUP BY ALL`);
  await escrever("moldes/vendas-teste/vendas.sql", `
    SELECT v.*, getvariable('data_referencia') - v.data AS dias, k.classe FROM main.vendas v JOIN clientes k USING (cliente)`);

  const c = await conexao();
  // Nomes como o ERP exporta (maiúsculas): o motor casa pelo nome normalizado.
  await c.run(`COPY (SELECT * FROM (VALUES ('1', DATE '2026-11-01', 80.0, 'A', 'x'), ('2', DATE '2026-11-05', 30.5, 'A', 'x'),
      ('3', DATE '2026-11-08', 10.0, 'B', 'x')) v(NrSaida, Data, VlrLiquido, Cliente, Extra)) TO '${arq("vendas.parquet")}' (FORMAT parquet)`);
  await c.run(`COPY (SELECT * FROM (VALUES ('A', 'AC'), ('B', NULL)) v(Cliente, UF)) TO '${arq("clientes.parquet")}' (FORMAT parquet)`);
  await c.run(`COPY (SELECT * FROM (VALUES (NULL, DATE '2026-11-01', 1.0, 'A')) v(NrSaida, Data, VlrLiquido, Cliente)) TO '${arq("vendas_vazia.parquet")}' (FORMAT parquet)`);
  await c.run(`COPY (SELECT * FROM (VALUES ('1', DATE '2026-11-01')) v(NrSaida, Data)) TO '${arq("vendas_curta.parquet")}' (FORMAT parquet)`);
});

describe("montar", () => {
  it("leva as oficiais pelo staging até as tabelas do molde", async () => {
    const conn = await conexao();
    const feitas = await montar(conn, carregarPacote(path.join(root, "pacote")), {
      camada: "oficial",
      arquivos: { vendas: arq("vendas.parquet"), clientes: arq("clientes.parquet") },
      saida: `${root}/saida`,
      dataReferencia: "2026-11-09",
    });
    expect(feitas.map((f) => [f.tabela, f.linhas])).toEqual([["clientes", 2], ["vendas", 3]]);
    expect(await linhas(conn, `SELECT cliente, uf, classe FROM '${root}/saida/vendas-teste/clientes.parquet' ORDER BY cliente`)).toEqual([
      { cliente: "A", uf: "AC", classe: "Gold" },
      { cliente: "B", uf: "NÃO CADASTRADO", classe: "Bronze" },
    ]);
    expect(await linhas(conn, `SELECT nrsaida, CAST(dias AS INTEGER) AS dias FROM '${root}/saida/vendas-teste/vendas.parquet' ORDER BY nrsaida`)).toEqual([
      { nrsaida: "1", dias: 8 }, { nrsaida: "2", dias: 4 }, { nrsaida: "3", dias: 1 },
    ]);
  });

  it("aceita a camada do modelo pronta, para conferir as receitas dos moldes", async () => {
    const feitas = await montar(await conexao(), carregarPacote(path.join(root, "pacote")), {
      camada: "modelo",
      arquivos: { vendas: arq("vendas.parquet"), clientes: arq("clientes.parquet") },
      saida: `${root}/saida-modelo`,
      dataReferencia: "2026-11-09",
    });
    expect(feitas).toHaveLength(2);
  });

  it("recusa coluna faltando, vazio em obrigatória e tabela não enviada", async () => {
    const p = carregarPacote(path.join(root, "pacote"));
    const run = async (vendas: string | undefined): Promise<unknown> =>
      montar(await conexao(), p, {
        camada: "oficial", arquivos: { ...(vendas ? { vendas: arq(vendas) } : {}), clientes: arq("clientes.parquet") },
        saida: `${root}/saida-erro`, dataReferencia: "2026-11-09",
      });
    await expect(run("vendas_curta.parquet")).rejects.toThrow(/faltam as colunas vlrliquido, cliente/);
    await expect(run("vendas_vazia.parquet")).rejects.toThrow(/vazio em coluna obrigatória: nrsaida/);
    await expect(run(undefined)).rejects.toThrow(ErroDeCarga);
  });

  it("recusa data de referência e molde inválidos", async () => {
    const p = carregarPacote(path.join(root, "pacote"));
    const base = { camada: "oficial" as const, arquivos: {}, saida: `${root}/x` };
    await expect(montar(await conexao(), p, { ...base, dataReferencia: "09/11/2026" })).rejects.toThrow(/AAAA-MM-DD/);
    await expect(montar(await conexao(), p, { ...base, dataReferencia: "2026-11-09", moldes: ["outro"] })).rejects.toThrow(/fora do pacote/);
  });
});

describe("pacote", () => {
  it("uma receita é uma consulta só", () => {
    expect(limparReceita("-- nota\nSELECT 1;\n", "r")).toBe("SELECT 1");
    expect(() => limparReceita("SELECT 1; DROP TABLE x", "r")).toThrow(/consulta só/);
    expect(() => limparReceita("COPY x TO 'y'", "r")).toThrow(/SELECT ou WITH/);
  });

  it("recusa nomes repetidos", () => {
    const r = pacoteSchema.safeParse({ ...PACOTE, modelo: [PACOTE.modelo[0], PACOTE.modelo[0]] });
    expect(r.success).toBe(false);
  });
});

describe("pacote odeon-erp", () => {
  it("é válido e tem receita para toda tabela de saída", () => {
    const p = carregarPacote(path.resolve(__dirname, "../../../feeds/odeon-erp"));
    expect(p.pacote.saidas.map((s) => s.molde)).toEqual(["vendas-filiais-produtos", "financeiro", "estoque-movimentacao"]);
    for (const s of p.pacote.saidas) expect(Object.keys(p.moldes[s.molde])).toEqual(s.tabelas);
  });
});
