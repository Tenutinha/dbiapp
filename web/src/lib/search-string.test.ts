import { describe, expect, it } from "vitest";
import { canonicalSearch, canonicalSearchOf, searchRecord } from "./search-string";

describe("canonicalSearch", () => {
  it("writes the same string for the same selection, whatever the order of the names", () => {
    const a = canonicalSearch(new URLSearchParams("x.t.cfop=5405&f.ano=2024&f.ano=2023"));
    const b = canonicalSearch(new URLSearchParams("f.ano=2024&f.ano=2023&x.t.cfop=5405"));
    expect(a).toBe("f.ano=2024&f.ano=2023&x.t.cfop=5405");
    expect(b).toBe(a);
  });

  it("keeps the order of the values of one name (it is the order they were picked in)", () => {
    expect(canonicalSearch(new URLSearchParams("f.ano=2023&f.ano=2024"))).not.toBe(canonicalSearch(new URLSearchParams("f.ano=2024&f.ano=2023")));
  });

  it("agrees between the record of the server and the params of the browser, accents and spaces included", () => {
    const browser = new URLSearchParams();
    browser.append("x.d_grupo.grupo", "Saída estadual");
    browser.append("f.mes", "2025-03");
    browser.append("f.mes", "2025-04");
    const server = { "f.mes": ["2025-03", "2025-04"], "x.d_grupo.grupo": "Saída estadual", vazio: undefined };
    expect(canonicalSearchOf(server)).toBe(canonicalSearch(browser));
    expect(canonicalSearchOf({})).toBe("");
  });

  it("comes back as the record a page receives", () => {
    expect(searchRecord("f.mes=2025-03&f.mes=2025-04&x.t.cfop=5405")).toEqual({ "f.mes": ["2025-03", "2025-04"], "x.t.cfop": "5405" });
    expect(canonicalSearchOf(searchRecord("f.b=2&f.a=1&f.b=3"))).toBe("f.a=1&f.b=2&f.b=3");
  });

  it("leaves out what is not the selection of the dashboard", () => {
    // The dashboard open in a shared space, a tracking code: the page may or may not pass them on.
    expect(canonicalSearch(new URLSearchParams("painel=abc&f.ano=2024&utm_source=x&d.t_cfop=cst"))).toBe("d.t_cfop=cst&f.ano=2024");
    expect(canonicalSearchOf({ painel: "abc", "f.ano": "2024" })).toBe(canonicalSearch(new URLSearchParams("f.ano=2024")));
  });

  it("takes any name as a name", () => {
    const record = searchRecord("__proto__=x&constructor=y&f.ano=2024&constructor=z");
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(Object.entries(record)).toEqual([["__proto__", "x"], ["constructor", ["y", "z"]], ["f.ano", "2024"]]);
  });
});
