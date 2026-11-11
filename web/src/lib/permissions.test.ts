import { describe, expect, it } from "vitest";
import { allowedActions, can, isMember, isValidSlug, slugify, visibleClientIds, type Membership } from "./permissions";

const ORG = { clientId: null };
const C1 = { clientId: "c1" };
const C2 = { clientId: "c2" };
const staff = (orgRole: Membership["orgRole"]): Membership => ({ orgRole, clientRoles: {} });
const actions = (m: Membership, scope: { clientId: string | null }) => [...allowedActions(m, scope)].sort();

describe("organization staff", () => {
  it("admin can do everything everywhere", () => {
    expect(actions(staff("admin"), ORG)).toEqual(["admin", "manageData", "record", "share", "view"]);
    expect(actions(staff("admin"), C1)).toEqual(["admin", "manageData", "record", "share", "view"]);
  });

  it("editor manages data for the org and every client, but is not admin", () => {
    expect(actions(staff("editor"), C2)).toEqual(["manageData", "record", "share", "view"]);
    expect(can(staff("editor"), ORG, "admin")).toBe(false);
  });

  it("analyst and viewer only see the organization's own dashboards", () => {
    expect(actions(staff("analyst"), ORG)).toEqual(["share", "view"]);
    expect(actions(staff("viewer"), ORG)).toEqual(["view"]);
    expect(actions(staff("analyst"), C1)).toEqual([]);
    expect(actions(staff("viewer"), C1)).toEqual([]);
  });
});

describe("client users", () => {
  const client1Viewer: Membership = { orgRole: null, clientRoles: { c1: "viewer" } };
  const client1Analyst: Membership = { orgRole: null, clientRoles: { c1: "analyst" } };

  it("see only their own client", () => {
    expect(actions(client1Viewer, C1)).toEqual(["view"]);
    expect(actions(client1Viewer, C2)).toEqual([]);
    expect(actions(client1Viewer, ORG)).toEqual([]);
  });

  it("never manage data or administer, even as analyst", () => {
    expect(actions(client1Analyst, C1)).toEqual(["record", "share", "view"]);
  });

  it("an analyst records entries (purchases, sales) of their own client only; a viewer never does", () => {
    expect(can(client1Analyst, C1, "record")).toBe(true);
    expect(can(client1Analyst, C2, "record")).toBe(false);
    expect(can(client1Analyst, ORG, "record")).toBe(false);
    expect(can(client1Viewer, C1, "record")).toBe(false);
  });

  it("can belong to several clients", () => {
    const m: Membership = { orgRole: null, clientRoles: { c1: "viewer", c2: "analyst" } };
    expect(visibleClientIds(m, ["c1", "c2", "c3"])).toEqual(["c1", "c2"]);
  });

  it("a staff viewer who is also a client analyst gets the client rights", () => {
    const m: Membership = { orgRole: "viewer", clientRoles: { c1: "analyst" } };
    expect(actions(m, C1)).toEqual(["record", "share", "view"]);
    expect(actions(m, ORG)).toEqual(["view"]);
  });
});

describe("platform admin (admin master)", () => {
  const master: Membership = { orgRole: null, clientRoles: {}, platformAdmin: true };

  it("can do everything in any organization and client, without being a member", () => {
    expect(isMember(master)).toBe(true);
    expect(actions(master, ORG)).toEqual(["admin", "manageData", "record", "share", "view"]);
    expect(actions(master, C2)).toEqual(["admin", "manageData", "record", "share", "view"]);
    expect(visibleClientIds(master, ["c1", "c2"])).toEqual(["c1", "c2"]);
  });

  it("an explicit false flag grants nothing extra", () => {
    expect(actions({ orgRole: "viewer", clientRoles: {}, platformAdmin: false }, C1)).toEqual([]);
  });

  it("'plataforma' cannot be used as an organization slug", () => {
    expect(isValidSlug("plataforma")).toBe(false);
    expect(isValidSlug("vitrine")).toBe(false);
  });
});

describe("membership", () => {
  it("strangers have no rights and are not members", () => {
    const none: Membership = { orgRole: null, clientRoles: {} };
    expect(isMember(none)).toBe(false);
    expect(actions(none, ORG)).toEqual([]);
    expect(visibleClientIds(none, ["c1"])).toEqual([]);
  });

  it("staff admin/editor see every client", () => {
    expect(visibleClientIds(staff("editor"), ["c1", "c2"])).toEqual(["c1", "c2"]);
    expect(visibleClientIds(staff("analyst"), ["c1", "c2"])).toEqual([]);
  });
});

describe("slugs", () => {
  it.each([
    ["Odeon Tecnologia", "odeon-tecnologia"],
    ["Cliente Nº 1 — São Paulo", "cliente-n-1-sao-paulo"],
    ["  --x--  ", "x"],
  ])("slugify(%s) = %s", (input, out) => expect(slugify(input)).toBe(out));

  it.each(["odeontecnologia", "cliente1", "a", "odeon-tec"])("accepts %s", (s) => expect(isValidSlug(s)).toBe(true));
  it.each(["", "-x", "x-", "Odeon", "a_b", "admin", "api", "s", "d", "x".repeat(41)])("rejects %s", (s) =>
    expect(isValidSlug(s)).toBe(false),
  );
});
