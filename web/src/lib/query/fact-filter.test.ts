import { describe, expect, it } from "vitest";
import { EMPTY_VALUE, factFilterSql, parseFactFilter, type FactFilter } from "./fact-filter";

const columns = ["ano", "cargo", "votos"];

describe("parseFactFilter", () => {
  it("keeps valid rules, trims and de-duplicates values", () => {
    expect(parseFactFilter([{ column: "cargo", op: "in", values: [" Presidente ", "Presidente", "Governador"] }], columns)).toEqual([
      { column: "cargo", op: "in", values: ["Presidente", "Governador"] },
    ]);
  });

  it("drops rules for columns that are not in the fact table and rules without values", () => {
    expect(parseFactFilter([
      { column: "senha", op: "in", values: ["x"] },
      { column: "ano", op: "in", values: [] },
      { column: "ano", op: "not_in", values: ["2018"] },
    ], columns)).toEqual([{ column: "ano", op: "not_in", values: ["2018"] }]);
  });

  it("keeps one rule per column (the last one wins)", () => {
    expect(parseFactFilter([
      { column: "ano", op: "in", values: ["2018"] },
      { column: "ano", op: "in", values: ["2022"] },
    ], columns)).toEqual([{ column: "ano", op: "in", values: ["2022"] }]);
  });

  it("treats anything malformed (old rows, null) as no filter", () => {
    expect(parseFactFilter(null, columns)).toEqual([]);
    expect(parseFactFilter({ hacked: true }, columns)).toEqual([]);
    expect(parseFactFilter([{ column: "ano", op: "drop table", values: ["1"] }], columns)).toEqual([]);
  });
});

describe("factFilterSql", () => {
  it("is empty without rules", () => {
    const params: string[] = [];
    expect(factFilterSql([], params)).toBe("");
    expect(params).toEqual([]);
  });

  it("binds every value as a parameter, numbering after the ones already there", () => {
    const params = ["x"];
    const filter: FactFilter = [
      { column: "cargo", op: "in", values: ["Presidente", "Governador"] },
      { column: "ano", op: "not_in", values: ["2018"] },
    ];
    expect(factFilterSql(filter, params)).toBe(
      `WHERE CAST("cargo" AS VARCHAR) IN ($2, $3) AND ("ano" IS NULL OR CAST("ano" AS VARCHAR) NOT IN ($4))`,
    );
    expect(params).toEqual(["x", "Presidente", "Governador", "2018"]);
  });

  it("turns the empty value into IS NULL / IS NOT NULL", () => {
    const params: string[] = [];
    expect(factFilterSql([{ column: "cargo", op: "in", values: ["Presidente", EMPTY_VALUE] }], params))
      .toBe(`WHERE (CAST("cargo" AS VARCHAR) IN ($1) OR "cargo" IS NULL)`);
    expect(params).toEqual(["Presidente"]);
    expect(factFilterSql([{ column: "cargo", op: "not_in", values: [EMPTY_VALUE] }], [])).toBe(`WHERE "cargo" IS NOT NULL`);
    expect(factFilterSql([{ column: "cargo", op: "in", values: [EMPTY_VALUE] }], [])).toBe(`WHERE "cargo" IS NULL`);
  });

  it("never puts a value in the SQL text", () => {
    const params: string[] = [];
    const sql = factFilterSql([{ column: "cargo", op: "in", values: ["'); DROP TABLE x; --"] }], params);
    expect(sql).not.toContain("DROP");
  });
});
