import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.DBI_DEMO_USER_EMAIL ??= "teste@example.com";

const { issueSectionTicket, readSectionTicket } = await import("./section-ticket");

const grant = {
  instanceId: "3f9a2c1b-7d2e-4c1a-9b0f-1e2d3c4b5a69",
  templateId: "efd-contribuicoes",
  activeVersionId: "a81c44e0-1111-4222-8333-944455556666",
};
const NOW = 1_800_000_000_000;

describe("section ticket", () => {
  it("carries the dashboard the page was given, and only for a while", () => {
    const ticket = issueSectionTicket(grant, NOW);
    expect(readSectionTicket(ticket, NOW + 60_000)).toEqual(grant);
    expect(readSectionTicket(ticket, NOW + 5 * 60 * 60 * 1000)).toBeNull();
  });

  it("refuses a ticket that was changed or made up", () => {
    const ticket = issueSectionTicket(grant, NOW);
    const [body, signature] = ticket.split(".");
    // Another dashboard under the same signature.
    const other = Buffer.from(JSON.stringify(["00000000-0000-4000-8000-000000000000", grant.templateId, grant.activeVersionId, NOW + 1000])).toString("base64url");
    expect(readSectionTicket(`${other}.${signature}`, NOW)).toBeNull();
    expect(readSectionTicket(`${body}.${signature.slice(0, -2)}xx`, NOW)).toBeNull();
    expect(readSectionTicket(body, NOW)).toBeNull();
    expect(readSectionTicket(`${ticket}.extra`, NOW)).toBeNull();
    expect(readSectionTicket("", NOW)).toBeNull();
    expect(readSectionTicket("a".repeat(700), NOW)).toBeNull();
  });
});
