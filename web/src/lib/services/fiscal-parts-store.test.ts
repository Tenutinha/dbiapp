import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));
const { isPartKey, localParts } = await import("./fiscal-parts-store");

describe("where the parts of a fiscal dashboard live", () => {
  it("keeps them on this machine only when asked, and never on the hosted app", () => {
    expect(localParts({})).toBe(false);
    expect(localParts({ DBI_FISCAL_LOCAL_PARTS: "1" })).toBe(true);
    expect(localParts({ DBI_FISCAL_LOCAL_PARTS: " true " })).toBe(true);
    expect(localParts({ DBI_FISCAL_LOCAL_PARTS: "0" })).toBe(false);
    expect(localParts({ DBI_FISCAL_LOCAL_PARTS: "1", VERCEL: "1" })).toBe(false);
  });

  it("tells a part from the other files a table is made from", () => {
    expect(isPartKey("orgs/acme/clientes/c/dashboards/ecd-3f9a2c1b/partes/11222333000181/2025-01/abc/registros.parquet")).toBe(true);
    expect(isPartKey("orgs/acme/clientes/c/dashboards/ecd-3f9a2c1b/v2/registros.1a2b3c4d.parquet")).toBe(false);
    expect(isPartKey("orgs/acme/clientes/c/fiscal/ecd/11222333000181/2025-01/ecd.1a2b3c4d.txt")).toBe(false);
  });
});
