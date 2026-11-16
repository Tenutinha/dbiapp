/**
 * ECD: the check of the DRE against the J150 of the file. The J150 changed in 2019 (leiaute 7), and most
 * months of a company that only sends the statements in December have no J150 at all.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { queryRows, withConnection } from "../duck/engine";
import { templateSchema } from "../templates/schema";

const template = templateSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "fiscal-templates", "ecd.json"), "utf8")));
const measure = (id: string): string => {
  const m = template.measures.find((x) => x.id === id);
  if (!m) throw new Error(`no measure ${id}`);
  return m.sql;
};
const root = mkdtempSync(path.join(os.tmpdir(), "dbi-ecd-j150-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** One fact row: file, record and its fields by position (c01…). */
type Line = [arquivo: string, registro: string, ...fields: (string | null)[]];
const WIDTH = 24;

/** The measures over these lines, by file, with the accounts 1 (revenue) and 2 (expense) of the result. */
async function byFile(lines: readonly Line[]): Promise<Record<string, { dre: number; j150: number | null; diff: number | null }>> {
  const cols = Array.from({ length: WIDTH }, (_, i) => `c${String(i + 1).padStart(2, "0")}`);
  const values = lines.map(([arquivo, registro, ...f], i) => {
    const cells = cols.map((_, j) => (f[j] === null || f[j] === undefined ? "NULL" : `'${f[j]}'`));
    const conta = registro.startsWith("I") ? `'c${f[0]}'` : "NULL";
    return `('${arquivo}', ${i + 1}, '${registro}', ${conta}, ${cells.join(", ")})`;
  });
  const sql = `
    WITH registros(arquivo, linha, registro, id_cta, ${cols.join(", ")}) AS (VALUES ${values.join(", ")}),
         plano_contas(id_cta, natureza, cod_cta_ref, grupo_3) AS (VALUES ('c1', '04', '3.01.01.01.01', 'RECEITA'), ('c2', '04', '3.01.01.07', 'DESPESAS'))
    SELECT registros.arquivo, ${measure("valor_dre")} AS dre, ${measure("lucro_liquido_j150")} AS j150, ${measure("diferenca_j150")} AS diff
    FROM registros LEFT JOIN plano_contas ON plano_contas.id_cta = registros.id_cta GROUP BY 1`;
  const rows = await withConnection(root, (conn) => queryRows(conn, sql));
  return Object.fromEntries(rows.map((r) => [String(r.arquivo), {
    dre: Number(r.dre), j150: r.j150 === null ? null : Number(r.j150), diff: r.diff === null ? null : Number(r.diff),
  }]));
}

/** I155 of a month: account, cost centre, opening balance and its D/C, debits, credits, closing balance and its D/C. */
const i155 = (file: string, account: string, ini: string, iniDc: string, fin: string, finDc: string): Line =>
  [file, "I155", account, null, ini, iniDc, "0", "0", fin, finDc];

describe("ECD: the DRE against the J150", () => {
  // Revenue account 1 went from 0 to 1.000 (credit) and expense account 2 from 0 to 400 (debit): a result of 600.
  const month = (file: string): Line[] => [i155(file, "1", "0", "C", "1000,00", "C"), i155(file, "2", "0", "D", "400,00", "D")];

  it("reads the current layout: the detail lines added up", async () => {
    const file = "11222333000181-2025-01";
    const out = await byFile([
      ...month(file),
      [file, "J150", "1", "900", "T", "1", null, "RESULTADO", "0", "C", "600,00", "C", "R"],
      [file, "J150", "2", "657", "D", "2", "900", "Receita", "0", "C", "1000,00", "C", "R"],
      [file, "J150", "3", "726", "D", "2", "900", "Despesa", "0", "D", "400,00", "D", "D"],
    ]);
    expect(out[file]).toEqual({ dre: 600, j150: 600, diff: 0 });
  });

  it("reads the old layout (until 2018) by its top line, with its sign", async () => {
    const profit = "11222333000181-2017-01";
    const loss = "11222333000181-2017-02";
    const out = await byFile([
      ...month(profit),
      [profit, "J150", "73000", "1", "RESULTADO LÍQUIDO DO PERÍODO", "600,00", "P", "0", "P"],
      [profit, "J150", "657", "2", "Receita", "1000,00", "R", "0", "R"],
      // A line whose sign does not follow IND_VL: the detail lines of this layout are not added up.
      [profit, "J150", "713", "2", "Ganho", "50,00", "R", "0", "R"],
      [profit, "J150", "726", "2", "Despesa", "400,00", "D", "0", "D"],
      i155(loss, "1", "0", "C", "100,00", "C"), i155(loss, "2", "0", "D", "400,00", "D"),
      [loss, "J150", "73000", "1", "RESULTADO LÍQUIDO DO PERÍODO", "300,00", "N", "0", "P"],
    ]);
    expect(out[profit]).toEqual({ dre: 600, j150: 600, diff: 0 });
    expect(out[loss]).toEqual({ dre: -300, j150: -300, diff: 0 });
  });

  it("gives no J150 and no difference to a month whose file has no J150", async () => {
    const file = "11222333000181-2022-03";
    const out = await byFile(month(file));
    expect(out[file]).toEqual({ dre: 600, j150: null, diff: null });
  });

  it("shows a real difference when the J150 leaves an account out", async () => {
    const file = "11222333000181-2019-12";
    const out = await byFile([
      ...month(file),
      [file, "J150", "1", "657", "D", "2", "900", "Receita", "0", "C", "1000,00", "C", "R"],
    ]);
    expect(out[file]).toEqual({ dre: 600, j150: 1000, diff: -400 });
  });

  it("checks month by month in the DRE section, and lists each layout with its own columns", () => {
    const table = template.visuals.find((v) => v.id === "t_dre_j150");
    expect(table).toMatchObject({ type: "table", fields: ["mes"], measures: ["valor_dre", "lucro_liquido_j150", "diferenca_j150"] });
    expect(template.analyses.find((a) => a.id === "dre")?.visuals).toContain("t_dre_j150");
    expect(template.visuals.some((v) => v.id === "k_dre_diferenca_j150")).toBe(false);
    const old = template.visuals.find((v) => v.id === "r_dre_antigo");
    expect(old?.type === "rows" ? old.columns.map((c) => c.label) : []).toEqual(["COD_AGL", "NIVEL_AGL", "DESCR_COD_AGL", "VL_CTA", "IND_VL", "VL_CTA_ULT_DRE", "IND_VL_ULT_DRE"]);
  });
});
