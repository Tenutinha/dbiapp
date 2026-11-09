import { describe, expect, it } from "vitest";
import type { TemplateTable } from "../templates/schema";
import { checkSchema } from "./schema-check";

const table = {
  name: "f_votacao",
  kind: "fact",
  description: "",
  columns: [
    { name: "ano", type: "integer", required: true },
    { name: "cd_municipio", type: "text", required: true },
    { name: "votos", type: "integer", required: true },
    { name: "cd_candidato", type: "text", required: false },
  ],
} as unknown as TemplateTable;

describe("checkSchema", () => {
  it("is ok when every column is there with a compatible type", () => {
    const r = checkSchema(table, [
      { name: "ANO", type: "BIGINT" },
      { name: "Cd Município", type: "VARCHAR" },
      { name: "votos", type: "INTEGER" },
      { name: "cd_candidato", type: "VARCHAR" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.columns.map((c) => c.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(r.columns[1].source).toBe("Cd Município");
  });

  it("flags a missing required column as a divergence", () => {
    const r = checkSchema(table, [
      { name: "ano", type: "BIGINT" },
      { name: "cd_municipio", type: "VARCHAR" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.columns.find((c) => c.name === "votos")?.status).toBe("missing");
    expect(r.columns.find((c) => c.name === "cd_candidato")?.status).toBe("optional");
    expect(r.errors).toEqual(['Coluna obrigatória "votos" não encontrada.']);
  });

  it("marks type differences as conversions (checked when the data is engaged), not divergences", () => {
    const r = checkSchema(table, [
      { name: "ano", type: "VARCHAR" },
      { name: "cd_municipio", type: "BIGINT" },
      { name: "votos", type: "DOUBLE" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.columns.slice(0, 3).map((c) => c.status)).toEqual(["convert", "convert", "convert"]);
  });

  it("lists columns that are not in the contract", () => {
    const r = checkSchema(table, [
      { name: "ano", type: "BIGINT" },
      { name: "cd_municipio", type: "VARCHAR" },
      { name: "votos", type: "BIGINT" },
      { name: "uf", type: "VARCHAR" },
    ]);
    expect(r.extras).toEqual(["uf"]);
  });

  it("reports duplicated headers", () => {
    const r = checkSchema(table, [
      { name: "Ano", type: "BIGINT" },
      { name: "ano", type: "BIGINT" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("mesmo nome");
  });
});
