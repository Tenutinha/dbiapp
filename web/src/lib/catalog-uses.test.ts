import { describe, expect, it } from "vitest";
import { archivedCount, inUseLabel, placeOf } from "./catalog-uses";

const use = (org: string, client: string | null, archived = false) => ({ org, client, dashboard: "D", archived });

describe("catalog uses", () => {
  it("names the client and its organization, or the organization alone", () => {
    expect(placeOf(use("Davos", "Martinello"))).toBe("Martinello (Davos)");
    expect(placeOf(use("DBI", null))).toBe("DBI");
  });

  it("lists the places in use once, then +N, leaving archived ones out", () => {
    const uses = [use("Davos", "Martinello"), use("Davos", "Martinello"), use("NTW", "Casa Prado"), use("Unimed", "Cuiaba"), use("Odeon", "SuperAuto", true)];
    expect(inUseLabel(uses)).toBe("Martinello (Davos), Casa Prado (NTW) +1");
    expect(inUseLabel(uses, 5)).toBe("Martinello (Davos), Casa Prado (NTW), Cuiaba (Unimed)");
    expect(inUseLabel([use("Odeon", "SuperAuto", true)])).toBe("");
    expect(archivedCount(uses)).toBe(1);
  });
});
