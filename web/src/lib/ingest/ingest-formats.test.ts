/**
 * Brazilian spellings in text files: decimal comma, dd/mm/aaaa dates, "|" as separator and free text
 * between quotes (with separators and line breaks inside). Runs the real ingest in DuckDB.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryRows, toDuckPath, withConnection } from "../duck/engine";
import type { TemplateTable } from "../templates/schema";
import { ingestTable } from "./ingest";

const table: TemplateTable = {
  name: "notas",
  kind: "fact",
  description: "",
  columns: [
    { name: "chave", type: "text", required: true },
    { name: "emissao_data", type: "date", required: true },
    { name: "valor", type: "decimal", required: true },
    { name: "quantidade", type: "decimal", required: false },
    { name: "observacao", type: "text", required: false },
    { name: "lido_em", type: "timestamp", required: false },
  ],
};

let root = "";
beforeAll(async () => {
  root = toDuckPath(await mkdtemp(path.join(os.tmpdir(), "dbi-formats-")));
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function ingest(name: string, content: string): Promise<{ errors: string[]; rows: Record<string, unknown>[] }> {
  const source = path.join(root, `${name}.txt`);
  const target = toDuckPath(path.join(root, `${name}.parquet`));
  await writeFile(source, content, "utf8");
  const report = await ingestTable({ storageRoot: root, table, sourcePath: toDuckPath(source), format: "csv", targetPath: target });
  if (!report.ok) return { errors: report.errors, rows: [] };
  const rows = await withConnection(root, (conn) =>
    queryRows(conn, `SELECT chave, CAST(emissao_data AS VARCHAR) AS emissao_data, valor, quantidade, observacao, CAST(lido_em AS VARCHAR) AS lido_em FROM read_parquet('${target}') ORDER BY chave`));
  return { errors: [], rows };
}

describe("ingest of Brazilian text formats", () => {
  it("reads decimal commas, dd/mm/aaaa dates and quoted text with separators and line breaks", async () => {
    const { errors, rows } = await ingest("br", [
      "﻿Chave|EMISSÃO_DATA|Valor|Quantidade|Observação|Lido em",
      "A|01/02/2022|1.234,56|1.0000|\"texto com | separador\"|03/02/2022 14:05",
      "B|28/12/2022|156,7400000000|2|\"duas\nlinhas\"|",
      "C|2022-03-15|-0,50|3.5|\"aspas \"\"dentro\"\"\"|2022-03-15 08:00:00",
    ].join("\r\n"));
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { chave: "A", emissao_data: "2022-02-01", valor: 1234.56, quantidade: 1, observacao: "texto com | separador", lido_em: "2022-02-03 14:05:00" },
      { chave: "B", emissao_data: "2022-12-28", valor: 156.74, quantidade: 2, observacao: "duas\nlinhas", lido_em: null },
      { chave: "C", emissao_data: "2022-03-15", valor: -0.5, quantidade: 3.5, observacao: "aspas \"dentro\"", lido_em: "2022-03-15 08:00:00" },
    ]);
  });

  it("still reports what is neither spelling", async () => {
    const { errors } = await ingest("ruim", ["chave;emissao_data;valor", "A;31/02/2022;10,5", "B;01/01/2022;dez"].join("\n"));
    expect(errors).toEqual([
      'Coluna "emissao_data": 1 valores não são do tipo date.',
      'Coluna "valor": 1 valores não são do tipo decimal.',
    ]);
  });
});
