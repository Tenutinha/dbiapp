import { describe, expect, it } from "vitest";
import { putLink, withSuggestions } from "./links";
import type { Link, LinkPhase } from "./types";

const wire = (table: string, phase: LinkPhase, file = `${table}.csv`): Link => ({ table, folder: "outra/pasta", file, phase });

describe("withSuggestions", () => {
  it("keeps the file that was just chosen while it is still being checked", () => {
    const chosen = wire("itens", "checking", "campos_2022.txt");
    expect(withSuggestions([chosen], [], "cliente")).toEqual([chosen]);
  });

  it("keeps every wire the person made, whatever its phase", () => {
    const phases: LinkPhase[] = ["checking", "ok", "diverge", "engaging", "engaged", "failed"];
    const links = phases.map((p, i) => wire(`t${i}`, p));
    expect(withSuggestions(links, [], "cliente")).toEqual(links);
  });

  it("does not suggest a file for a table that already has a wire", () => {
    const chosen = wire("itens", "ok", "campos_2022.txt");
    const out = withSuggestions([chosen], [{ table: "itens", file: "itens.parquet" }, { table: "notas", file: "notas.parquet" }], "cliente");
    expect(out).toEqual([chosen, { table: "notas", folder: "cliente", file: "notas.parquet", phase: "suggested" }]);
  });

  it("renews the suggestions: old ones go, the new listing comes", () => {
    const out = withSuggestions([wire("itens", "suggested", "velho.csv")], [{ table: "itens", file: "novo.csv" }], "cliente");
    expect(out).toEqual([{ table: "itens", folder: "cliente", file: "novo.csv", phase: "suggested" }]);
  });
});

describe("putLink", () => {
  it("replaces the wire of the same table and keeps the others", () => {
    const a = wire("a", "ok");
    const out = putLink([a, wire("b", "checking")], wire("b", "ok"));
    expect(out).toEqual([a, wire("b", "ok")]);
  });
});
