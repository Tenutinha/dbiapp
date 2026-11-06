import { describe, expect, it } from "vitest";
import { loadTemplate } from "../test-helpers";
import { breakingChanges, checkUpdate, parseTemplateJson } from "./catalog-rules";

const base = loadTemplate("vendas-executivo");
const json = (v: unknown): string => JSON.stringify(v);

describe("parseTemplateJson", () => {
  it("accepts a valid template", () => {
    const r = parseTemplateJson(json(base));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.template.id).toBe("vendas-executivo");
  });

  it("explains invalid JSON", () => {
    const r = parseTemplateJson("{ nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/JSON inválido/);
  });

  it("lists schema problems with their location", () => {
    const r = parseTemplateJson(json({ ...base, id: "Com Espaço", measures: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("id:"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("measures:"))).toBe(true);
    }
  });

  it("rejects unsafe SQL in measures", () => {
    const evil = { ...base, measures: [{ ...base.measures[0], sql: "1; DROP TABLE users" }] };
    expect(parseTemplateJson(json(evil)).ok).toBe(false);
  });

  it("rejects empty and oversized input", () => {
    expect(parseTemplateJson("").ok).toBe(false);
    expect(parseTemplateJson(" ".repeat(600 * 1024)).ok).toBe(false);
  });
});

describe("breakingChanges", () => {
  it("is empty when only layout changes", () => {
    expect(breakingChanges(base, { ...base, visuals: base.visuals.slice(0, 1) })).toEqual([]);
  });

  it("reports removed tables and columns and type changes", () => {
    const [first, ...rest] = base.tables;
    const changedFirst = {
      ...first,
      columns: first.columns.slice(1).map((c, i) => (i === 0 ? { ...c, type: c.type === "text" ? ("integer" as const) : ("text" as const) } : c)),
    };
    const removedColumn = first.columns[0].name;
    const changes = breakingChanges(base, { ...base, tables: [changedFirst, ...rest.slice(1)] });
    expect(changes.some((c) => c.includes(`${first.name}.${removedColumn}`))).toBe(true);
    expect(changes.some((c) => c.includes(rest[0].name))).toBe(true);
    expect(changes.some((c) => c.includes("tipo"))).toBe(true);
  });
});

describe("checkUpdate", () => {
  it("requires the same id", () => {
    expect(checkUpdate(base, { ...base, id: "outro" })).toMatch(/identificador/);
  });
  it("requires a higher version when the definition changes", () => {
    expect(checkUpdate(base, { ...base, name: "Novo nome" })).toMatch(/versão/);
    expect(checkUpdate(base, { ...base, name: "Novo nome", version: base.version + 1 })).toBeNull();
  });
  it("accepts an identical definition", () => {
    expect(checkUpdate(base, base)).toBeNull();
  });
});
