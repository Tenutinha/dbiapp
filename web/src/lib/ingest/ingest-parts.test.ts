/**
 * Several files for one table: each is converted on its own (ingestTable) into a part, the parts are
 * checked as a whole (inspectParts) and the table is read from all of them (readParquet) — nothing is
 * rewritten into one file. Runs the real conversion and the real queries in DuckDB.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryRows, readParquet, toDuckPath, withConnection } from "../duck/engine";
import { buildFrom } from "../query/build";
import { joinParts } from "../storage-parts";
import type { Template, TemplateTable } from "../templates/schema";
import { checkRelationships, ingestTable, inspectParts, type TablePart } from "./ingest";

const fact: TemplateTable = {
  name: "notas",
  kind: "fact",
  description: "",
  sortBy: "emissao_data",
  columns: [
    { name: "chave", type: "text", required: true },
    { name: "emissao_data", type: "date", required: true },
    { name: "valor", type: "decimal", required: true },
    { name: "produto", type: "text", required: false },
    { name: "observacao", type: "text", required: false },
  ],
};

const dimension: TemplateTable = {
  name: "produtos",
  kind: "dimension",
  description: "",
  key: "codigo",
  columns: [
    { name: "codigo", type: "text", required: true },
    { name: "nome", type: "text", required: true },
  ],
};

let root = "";
beforeAll(async () => {
  root = toDuckPath(await mkdtemp(path.join(os.tmpdir(), "dbi-parts-")));
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/** Converts one text file the way the connector does for each file of the list. */
async function part(table: TemplateTable, name: string, content: string): Promise<TablePart> {
  const source = toDuckPath(path.join(root, name));
  const target = toDuckPath(path.join(root, `${name}.parquet`));
  await writeFile(source, content, "utf8");
  const report = await ingestTable({ storageRoot: root, table, sourcePath: source, format: "csv", targetPath: target });
  expect(report.errors).toEqual([]);
  return { path: target, name };
}

const tableOf = (parts: readonly TablePart[]): string => joinParts(parts.map((p) => p.path));
const query = (sql: string) => withConnection(root, (conn) => queryRows(conn, sql));

describe("a table fed by several files", () => {
  it("is read from all its parts as one table, with the rows of each file counted", async () => {
    const parts = [
      await part(fact, "2022.txt", "chave;emissao_data;valor\na;01/02/2022;1,00\nb;31/12/2022;2,00\ne;15/06/2022;3,00\n"),
      await part(fact, "2023.txt", "chave;emissao_data;valor\nc;05/01/2023;10,50\nd;20/03/2023;1.000,00\n"),
    ];
    const inspected = await inspectParts(root, fact, parts);

    expect(inspected).toEqual({
      files: [{ name: "2022.txt", rowCount: 3 }, { name: "2023.txt", rowCount: 2 }],
      rowCount: 5,
      errors: [],
    });
    const rows = await query(`SELECT year(emissao_data) AS ano, COUNT(*) AS n, SUM(valor) AS total FROM ${readParquet(tableOf(parts))} GROUP BY 1 ORDER BY 1`);
    expect(rows).toEqual([{ ano: 2022, n: 3, total: 6 }, { ano: 2023, n: 2, total: 1010.5 }]);
  });

  it("reads a table of one part exactly as before", () => {
    expect(readParquet("C:\\dados\\itens.parquet")).toBe("read_parquet('C:/dados/itens.parquet')");
    expect(readParquet(joinParts(["/d/2022.parquet", "/d/2023.parquet"]))).toBe("read_parquet(['/d/2022.parquet', '/d/2023.parquet'])");
  });

  it("keeps an optional column that only some files bring (the others have it empty)", async () => {
    const parts = [
      await part(fact, "com.txt", "chave;emissao_data;valor;observacao\na;01/01/2024;1,00;veio\n"),
      await part(fact, "sem.txt", "chave;emissao_data;valor\nb;02/01/2024;2,00\n"),
    ];
    expect(await query(`SELECT chave, observacao FROM ${readParquet(tableOf(parts))} ORDER BY chave`)).toEqual([
      { chave: "a", observacao: "veio" },
      { chave: "b", observacao: null },
    ]);
  });

  it("refuses a dimension key that is in two files and says in which", async () => {
    const parts = [
      await part(dimension, "linha-a.csv", "codigo,nome\nP1,Parafuso\nP2,Porca\n"),
      await part(dimension, "linha-b.csv", "codigo,nome\nP3,Arruela\nP2,Porca sextavada\n"),
    ];
    const inspected = await inspectParts(root, dimension, parts);

    expect(inspected.errors).toEqual([
      'Chave "codigo" repetida em 1 linhas entre os arquivos: "P2" em linha-a.csv e linha-b.csv. Cada chave pode estar em um arquivo só.',
    ]);
  });

  it("accepts a dimension whose keys do not repeat between files", async () => {
    const parts = [
      await part(dimension, "d1.csv", "codigo,nome\nP1,Parafuso\n"),
      await part(dimension, "d2.csv", "codigo,nome\nP2,Porca\n"),
    ];
    expect(await inspectParts(root, dimension, parts)).toEqual({
      files: [{ name: "d1.csv", rowCount: 1 }, { name: "d2.csv", rowCount: 1 }],
      rowCount: 2,
      errors: [],
    });
  });

  it("does not look for repeated rows in a fact table (the same period in two files counts twice)", async () => {
    const same = "chave;emissao_data;valor\na;01/02/2022;1,00\n";
    const parts = [await part(fact, "um.txt", same), await part(fact, "copia.txt", same)];
    expect((await inspectParts(root, fact, parts)).errors).toEqual([]);
  });

  it("fails clearly when a part is gone", async () => {
    const good = await part(dimension, "fica.csv", "codigo,nome\nP1,Parafuso\n");
    const inspected = await inspectParts(root, dimension, [good, { path: `${root}/nao-existe.parquet`, name: "x.csv" }]);
    expect(inspected.errors).toEqual(["Não foi possível ler os arquivos convertidos. Engate de novo."]);
  });

  it("joins and checks relationships over the parts", async () => {
    const facts = [
      await part(fact, "f1.txt", "chave;emissao_data;valor;produto\na;01/02/2022;1,00;P1\nb;02/02/2022;2,00;P9\n"),
      await part(fact, "f2.txt", "chave;emissao_data;valor;produto\nc;01/02/2023;4,00;P2\n"),
    ];
    const dims = [
      await part(dimension, "p1.csv", "codigo,nome\nP1,Parafuso\n"),
      await part(dimension, "p2.csv", "codigo,nome\nP2,Porca\n"),
    ];
    const relationships = [{ from: { table: "notas", column: "produto" }, to: { table: "produtos", column: "codigo" } }];
    const files = { notas: tableOf(facts), produtos: tableOf(dims) };

    expect(await checkRelationships(root, relationships, files)).toEqual([{ relationship: "notas.produto → produtos", orphans: 1 }]);
    const template = { tables: [fact, dimension], relationships } as unknown as Template;
    const rows = await query(`SELECT produtos.nome AS nome, SUM(notas.valor) AS total ${buildFrom(template, files)} GROUP BY 1 ORDER BY 1 NULLS LAST`);
    expect(rows).toEqual([{ nome: "Parafuso", total: 1 }, { nome: "Porca", total: 4 }, { nome: null, total: 2 }]);
  });
});
