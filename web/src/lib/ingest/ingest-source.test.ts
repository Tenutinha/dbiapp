/**
 * Tables fed from a raw source (template `source`): the file is checked against the raw columns, each
 * stored column is derived from them and rows are summed up on the way in. Real sandboxed DuckDB.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryRows, toDuckPath, withConnection } from "../duck/engine";
import { buildFrom } from "../query/build";
import { loadTemplate } from "../test-helpers";
import { templateSchema, type TemplateTable } from "../templates/schema";
import { transformSelect } from "./contract";
import { ingestTable } from "./ingest";
import { checkSchema } from "./schema-check";

const t = loadTemplate("eleicoes-presidente");
const table = (name: string): TemplateTable => t.tables.find((x) => x.name === name)!;
let root = "";
const file = (f: string): string => path.join(root, "_in", f);

beforeAll(async () => {
  root = toDuckPath(await mkdtemp(path.join(os.tmpdir(), "dbi-source-")));
  await mkdir(path.join(root, "_in"), { recursive: true });
  const c = await (await DuckDBInstance.create(":memory:")).connect();
  const q = (f: string): string => `'${toDuckPath(file(f))}'`;
  // Two polling stations of the same municipality (1007) and one abroad (ZZ), as in vw_f_votacao_secao.
  await c.run(`COPY (SELECT * FROM (VALUES
      ('2026','1','PRESIDENTE','AC','AC|1007|9|1','280002542548','LULA DA SILVA', 10, 'x'),
      ('2026','1','PRESIDENTE','AC','AC|1007|9|2','280002542548','LULA DA SILVA', 5, 'x'),
      ('2026','1','PRESIDENTE','AC','AC|1007|9|1','-1','VOTO BRANCO', 2, 'x'),
      ('2026','1','PRESIDENTE','AC','AC|1007|9|2','-1','VOTO NULO', 1, 'x'),
      ('2026','1','PRESIDENTE','AC','AC|1007|9|2','-3','PARTIDO DOS TRABALHADORES', 4, 'x'),
      ('2026','1','PRESIDENTE','ZZ','ZZ|29173|1|1','280002542548','LULA DA SILVA', 7, 'x'),
      ('2010','1','PRESIDENTE','AC','AC|1007|9|1', NULL,'DILMA VANA ROUSSEFF', 3, 'x')
    ) v(ano_eleicao, nr_turno, ds_cargo, sg_uf, chave_local, sq_candidato, nm_votavel, qt_votos, extra))
    TO ${q("votos.parquet")} (FORMAT parquet)`);
  await c.run(`COPY (SELECT * FROM (VALUES
      ('2026|1|BR|6257|1|280002542548','2026','PRESIDENTE','BR','LULA','LUIZ INÁCIO','PT', 13, 'ELEITO'),
      ('2026|2|BR|6258|1|280002542548','2026','PRESIDENTE','BR','LULA','LUIZ INÁCIO','PT', 13, '#NULO')
    ) v(chave_candidato, ano_eleicao, ds_cargo, sg_uf, nm_urna_candidato, nm_candidato, sg_partido, nr_candidato, ds_sit_tot_turno))
    TO ${q("candidatos.parquet")} (FORMAT parquet)`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("transformSelect", () => {
  it("derives every stored column, casts it and groups by the identifying columns", () => {
    const sql = transformSelect(table("f_votacao"), "(SELECT 1)");
    expect(sql).toContain('CAST((SUM(qt_votos)) AS BIGINT) AS "votos"');
    expect(sql).toContain('CAST((upper(trim(ds_cargo))) AS VARCHAR) AS "cargo"');
    expect(sql).toMatch(/FROM \(SELECT 1\) AS bruto GROUP BY 1, 2, 3, 4, 5, 6, 7, 8$/);
  });

  it("copies raw columns of the same name when nothing is derived", () => {
    const tb = { ...table("d_partido"), source: { ...table("d_partido").source!, derive: {} } };
    expect(transformSelect(tb, "x")).toContain('CAST(("nome") AS VARCHAR) AS "nome"');
  });
});

describe("ingest from a raw source", () => {
  it("sums polling stations into one row per municipality and candidate", async () => {
    const out = path.join(root, "out", "f.parquet");
    const r = await ingestTable({ storageRoot: root, table: table("f_votacao"), sourcePath: file("votos.parquet"), format: "parquet", targetPath: out });
    expect(r.ok).toBe(true);
    const rows = await withConnection(root, (c) =>
      queryRows(c, `SELECT ano, uf, cd_municipio, categoria, cd_candidato, votos FROM read_parquet('${toDuckPath(out)}') ORDER BY ano DESC, uf, categoria, votos DESC`));
    expect(rows).toEqual([
      { ano: 2026, uf: "AC", cd_municipio: "1007", categoria: "branco", cd_candidato: null, votos: 2 },
      { ano: 2026, uf: "AC", cd_municipio: "1007", categoria: "candidato", cd_candidato: "2026-280002542548", votos: 15 },
      { ano: 2026, uf: "AC", cd_municipio: "1007", categoria: "legenda", cd_candidato: null, votos: 4 },
      { ano: 2026, uf: "AC", cd_municipio: "1007", categoria: "nulo", cd_candidato: null, votos: 1 },
      // exterior: no municipality code (not in the register), still counted
      { ano: 2026, uf: "ZZ", cd_municipio: null, categoria: "candidato", cd_candidato: "2026-280002542548", votos: 7 },
      // 2010: no sequential in the file, the name stays in nome_votavel
      { ano: 2010, uf: "AC", cd_municipio: "1007", categoria: "candidato", cd_candidato: null, votos: 3 },
    ]);
  });

  it("collapses a candidate's two turns into one dimension row (unique key)", async () => {
    const out = path.join(root, "out", "c.parquet");
    const r = await ingestTable({ storageRoot: root, table: table("d_candidato"), sourcePath: file("candidatos.parquet"), format: "parquet", targetPath: out });
    expect(r.ok).toBe(true);
    expect(r.rowCount).toBe(1);
  });

  it("checks files against the raw columns, not the stored ones", () => {
    const raw = ["ano_eleicao", "nr_turno", "ds_cargo", "sg_uf", "chave_local", "sq_candidato", "nm_votavel", "qt_votos"]
      .map((name) => ({ name, type: name === "qt_votos" ? "INTEGER" : "VARCHAR" }));
    expect(checkSchema(table("f_votacao"), raw).ok).toBe(true);
    const stored = table("f_votacao").columns.map((c) => ({ name: c.name, type: "VARCHAR" }));
    expect(checkSchema(table("f_votacao"), stored).ok).toBe(false);
  });
});

describe("schema rules for raw sources and snowflake joins", () => {
  const withFact = (patch: Partial<TemplateTable>) =>
    ({ ...t, tables: t.tables.map((tb) => (tb.name === "f_votacao" ? { ...tb, ...patch } : tb)) });

  it("rejects a stored column that is neither derived nor a raw column", () => {
    const source = { ...table("f_votacao").source!, derive: { ...table("f_votacao").source!.derive } };
    delete (source.derive as Record<string, string>).cargo;
    expect(JSON.stringify(templateSchema.safeParse(withFact({ source })).error?.issues)).toContain("cargo");
  });

  it("with groupBy, refuses a column copied as is (it would need an aggregate)", () => {
    // d_partido copies "nome" from the raw file: grouping by sigla alone leaves it unaggregated.
    const tables = t.tables.map((tb) => (tb.name === "d_partido" ? { ...tb, source: { ...tb.source!, groupBy: ["sigla"] } } : tb));
    expect(JSON.stringify(templateSchema.safeParse({ ...t, tables }).error?.issues)).toContain("d_partido.nome");
  });

  it("accepts a relationship from a dimension already joined, not one that comes first", () => {
    const reversed = { ...t, relationships: [...t.relationships].reverse() };
    expect(templateSchema.safeParse(t).success).toBe(true);
    expect(templateSchema.safeParse(reversed).success).toBe(false);
  });

  it("joins the dimension in between when only the far one is used", () => {
    const files = Object.fromEntries(t.tables.map((tb) => [tb.name, `/d/${tb.name}.parquet`]));
    const from = buildFrom(t, files, [], [], (name) => name === "d_partido");
    expect(from).toContain("AS d_candidato ON f_votacao.cd_candidato = d_candidato.cd_candidato");
    expect(from).toContain("AS d_partido ON d_candidato.partido = d_partido.sigla");
    expect(from).not.toContain("d_municipio");
  });
});
