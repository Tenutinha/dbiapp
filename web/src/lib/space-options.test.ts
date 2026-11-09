import { describe, expect, it } from "vitest";
import { spaceOptions } from "./space-options";

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
    expect(opts).toEqual([{ href: "/mapa/estadual", label: "Deputado Estadual", kind: "client", current: true }]);
  });

  it("keeps the organization when it is the current space", () => {
    const opts = spaceOptions(org, null, false, []);
    expect(opts).toEqual([{ href: "/mapa", label: "Mapa da Votação", kind: "org", current: true }]);
  });
});
