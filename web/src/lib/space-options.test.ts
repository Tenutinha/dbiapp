import { describe, expect, it } from "vitest";
import { filterSpaces, orgOptions, spaceOptions } from "./space-options";

const org = { slug: "mapa", name: "Mapa da Votação" };
const clients = [
  { id: "c1", slug: "estadual", name: "Deputado Estadual" },
  { id: "c2", slug: "federal", name: "Deputado Federal" },
];

describe("spaceOptions", () => {
  it("lists the organization first, then its clients, marking the current space", () => {
    const opts = spaceOptions(org, "c2", true, clients);
    expect(opts.map((o) => o.href)).toEqual(["/mapa", "/mapa/estadual", "/mapa/federal"]);
    expect(opts.filter((o) => o.current).map((o) => o.label)).toEqual(["Deputado Federal"]);
    expect(opts[0].kind).toBe("org");
  });

  it("leaves the organization out for a client user who cannot view it", () => {
    const opts = spaceOptions(org, "c1", false, [clients[0]]);
    expect(opts).toEqual([{ href: "/mapa/estadual", label: "Deputado Estadual", kind: "client", current: true, logoUrl: null }]);
  });

  it("gives each space its own logo, and none to the spaces that did not set one", () => {
    const logos = new Map<string | null, string>([
      [null, "/api/branding/logo/org"],
      ["c2", "/api/branding/logo/federal"],
    ]);
    const opts = spaceOptions(org, "c1", true, clients, logos);
    expect(opts.map((o) => o.logoUrl)).toEqual(["/api/branding/logo/org", null, "/api/branding/logo/federal"]);
  });

  it("filters by name ignoring accents and case, keeping the order", () => {
    const opts = spaceOptions(org, null, true, clients);
    expect(filterSpaces(opts, "  deputado ").map((o) => o.label)).toEqual(["Deputado Estadual", "Deputado Federal"]);
    expect(filterSpaces(opts, "VOTACAO").map((o) => o.label)).toEqual(["Mapa da Votação"]);
    expect(filterSpaces(opts, "")).toEqual(opts);
    expect(filterSpaces(opts, "senado")).toEqual([]);
  });

  it("keeps the organization when it is the current space", () => {
    const opts = spaceOptions(org, null, false, []);
    expect(opts).toEqual([{ href: "/mapa", label: "Mapa da Votação", kind: "org", current: true, logoUrl: null }]);
  });
});

describe("orgOptions", () => {
  it("lists every organization of the person, marking the open one", () => {
    const opts = orgOptions([{ slug: "davos", name: "Davos" }, { slug: "ntw", name: "NTW" }], "ntw");
    expect(opts).toEqual([
      { href: "/davos", label: "Davos", kind: "org", current: false, logoUrl: null },
      { href: "/ntw", label: "NTW", kind: "org", current: true, logoUrl: null },
    ]);
  });
});
