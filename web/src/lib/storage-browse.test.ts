import { describe, expect, it } from "vitest";
import { browseCrumbs, browsePrefix, relativeToOrg } from "./storage-browse";

describe("browsePrefix", () => {
  it("is the organization's folder for an empty path", () => {
    expect(browsePrefix("mapa-da-votacao", "")).toBe("orgs/mapa-da-votacao/");
    expect(browsePrefix("mapa-da-votacao", undefined)).toBe("orgs/mapa-da-votacao/");
  });

  it("appends a sub-folder with a trailing slash, tolerating extra slashes", () => {
    expect(browsePrefix("mapa-da-votacao", "acervo/backup")).toBe("orgs/mapa-da-votacao/acervo/backup/");
    expect(browsePrefix("mapa-da-votacao", "/acervo/backup/")).toBe("orgs/mapa-da-votacao/acervo/backup/");
  });

  it.each(["../outra-org", "acervo/../../x", "acervo//x", "acervo/a b", "acervo/%2e%2e", "./acervo"])(
    "rejects %j (never leaves the organization's folder)",
    (sub) => {
      expect(() => browsePrefix("mapa-da-votacao", sub)).toThrow();
    },
  );

  it("rejects an invalid organization slug", () => {
    expect(() => browsePrefix("../x", "")).toThrow();
  });
});

describe("relativeToOrg", () => {
  it("strips the organization's folder from a key", () => {
    expect(relativeToOrg("acme", "orgs/acme/acervo/x.parquet")).toBe("acervo/x.parquet");
    expect(relativeToOrg("acme", "orgs/acme/acervo/")).toBe("acervo/");
  });
});

describe("browseCrumbs", () => {
  it("lists each level down to the current folder", () => {
    expect(browseCrumbs("acervo/backup/BR")).toEqual([
      { label: "acervo", path: "acervo" },
      { label: "backup", path: "acervo/backup" },
      { label: "BR", path: "acervo/backup/BR" },
    ]);
    expect(browseCrumbs("")).toEqual([]);
  });
});
