import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.DBI_DEMO_USER_EMAIL ??= "teste@example.com";

const { hashPassword, isValidPass, issuePass, passCookieName, PASS_TTL_MS, verifyPassword } = await import("./link-password");

const LINK = "0b9d6c55-6f0e-4b5e-9d64-3c1b2a7f9e10";

describe("link password", () => {
  it("keeps only a salted hash and checks the password against it", () => {
    const stored = hashPassword("segredo-123");
    expect(stored).toMatch(/^scrypt\$[\w-]+\$[\w-]+$/);
    expect(stored).not.toContain("segredo");
    expect(hashPassword("segredo-123")).not.toBe(stored); // a new salt each time
    expect(verifyPassword("segredo-123", stored)).toBe(true);
    expect(verifyPassword("segredo-124", stored)).toBe(false);
    expect(verifyPassword("segredo-123", "lixo")).toBe(false);
  });
});

describe("pass cookie", () => {
  const hash = hashPassword("abc123");

  it("opens the link it was issued for, until it expires", () => {
    const now = Date.now();
    const pass = issuePass(LINK, hash, now);
    expect(isValidPass(pass, LINK, hash, now + 1000)).toBe(true);
    expect(isValidPass(pass, LINK, hash, now + PASS_TTL_MS + 1)).toBe(false);
  });

  it("does not open another link, nor the same link after its password changed", () => {
    const pass = issuePass(LINK, hash);
    expect(isValidPass(pass, "11111111-1111-1111-1111-111111111111", hash)).toBe(false);
    expect(isValidPass(pass, LINK, hashPassword("abc123"))).toBe(false);
  });

  it("rejects forged or malformed passes", () => {
    const [exp] = issuePass(LINK, hash).split(".");
    expect(isValidPass(`${Number(exp) + 999999}.${issuePass(LINK, hash).split(".")[1]}`, LINK, hash)).toBe(false);
    expect(isValidPass(undefined, LINK, hash)).toBe(false);
    expect(isValidPass("abc", LINK, hash)).toBe(false);
    expect(isValidPass("1.2.3", LINK, hash)).toBe(false);
  });

  it("names one cookie per link", () => {
    expect(passCookieName(LINK)).toBe("dbi-link-0b9d6c556f0e4b5e");
  });
});
