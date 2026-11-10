import { describe, expect, it } from "vitest";
import { activeLink, chooseDashboard, expiryDate, linkState, type SpaceLinkRow } from "./space-link";

const now = new Date("2026-11-10T12:00:00.000Z").getTime();
const row = (over: Partial<SpaceLinkRow>): SpaceLinkRow => ({
  id: "l1", token: "t", expiresAt: null, revokedAt: null, createdAt: new Date("2026-11-01T00:00:00.000Z"), ...over,
});

describe("expiryDate", () => {
  it("turns the choice into a date (or none)", () => {
    expect(expiryDate("1", now)?.toISOString()).toBe("2026-11-11T12:00:00.000Z");
    expect(expiryDate("30", now)?.toISOString()).toBe("2026-12-10T12:00:00.000Z");
    expect(expiryDate("never", now)).toBeNull();
  });
});

describe("linkState", () => {
  it("is active until revoked or expired", () => {
    expect(linkState(row({}), now)).toBe("active");
    expect(linkState(row({ expiresAt: new Date("2026-11-20T00:00:00.000Z") }), now)).toBe("active");
    expect(linkState(row({ expiresAt: new Date("2026-11-09T00:00:00.000Z") }), now)).toBe("expired");
    expect(linkState(row({ revokedAt: new Date("2026-11-05T00:00:00.000Z") }), now)).toBe("revoked");
  });
});

describe("activeLink", () => {
  it("is the newest link still valid, if any", () => {
    const old = row({ id: "a", createdAt: new Date("2026-10-01T00:00:00.000Z") });
    const fresh = row({ id: "b", createdAt: new Date("2026-11-02T00:00:00.000Z") });
    const gone = row({ id: "c", createdAt: new Date("2026-11-03T00:00:00.000Z"), revokedAt: new Date("2026-11-04T00:00:00.000Z") });
    expect(activeLink([old, gone, fresh], now)?.id).toBe("b");
    expect(activeLink([gone], now)).toBeNull();
  });
});

describe("chooseDashboard", () => {
  it("opens the requested dashboard only if it is in the space's published summary", () => {
    expect(chooseDashboard(["d1", "d2"], "d2")).toBe("d2");
    expect(chooseDashboard(["d1", "d2"], "outro")).toBe("d1");
    expect(chooseDashboard(["d1", "d2"], undefined)).toBe("d1");
    expect(chooseDashboard([], "d1")).toBeNull();
  });
});
