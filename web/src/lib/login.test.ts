import { describe, expect, it } from "vitest";
import {
  emailSchema,
  newPasswordSchema,
  passwordSchema,
  safeNextPath,
  signInErrorMessage,
} from "./login";

describe("emailSchema", () => {
  it("normalizes case and spaces", () => {
    expect(emailSchema.parse("  Ana@Empresa.COM ")).toBe("ana@empresa.com");
  });
  it("rejects invalid addresses", () => {
    expect(emailSchema.safeParse("ana@").success).toBe(false);
    expect(emailSchema.safeParse(null).success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("requires a non-empty password", () => {
    expect(passwordSchema.safeParse("").success).toBe(false);
    expect(passwordSchema.safeParse("x").success).toBe(true);
  });
});

describe("newPasswordSchema", () => {
  it("accepts a strong enough matching pair", () => {
    expect(newPasswordSchema.safeParse({ password: "senha-forte-1", confirm: "senha-forte-1" }).success).toBe(true);
  });
  it("rejects short passwords", () => {
    const r = newPasswordSchema.safeParse({ password: "abc12", confirm: "abc12" });
    expect(r.success).toBe(false);
  });
  it("rejects passwords over the bcrypt limit", () => {
    const long = "a1".repeat(40);
    expect(newPasswordSchema.safeParse({ password: long, confirm: long }).success).toBe(false);
  });
  it("requires letters and numbers", () => {
    expect(newPasswordSchema.safeParse({ password: "somenteletras", confirm: "somenteletras" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "1234567890", confirm: "1234567890" }).success).toBe(false);
  });
  it("rejects mismatched confirmation", () => {
    const r = newPasswordSchema.safeParse({ password: "senha-forte-1", confirm: "senha-forte-2" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["confirm"]);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/entrar/nova-senha")).toBe("/entrar/nova-senha");
    expect(safeNextPath("/acme/cliente-1")).toBe("/acme/cliente-1");
  });
  it("falls back to home for anything that could leave the site", () => {
    for (const bad of [null, "", "https://evil.com", "//evil.com", "/\\evil.com", "/%2F%2Fevil.com", "javascript:alert(1)", "/a?x=1", "/a#b"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});

describe("signInErrorMessage", () => {
  it("maps known Supabase errors to Portuguese messages", () => {
    expect(signInErrorMessage({ status: 400, code: "invalid_credentials" })).toMatch(/incorretos/);
    expect(signInErrorMessage({ status: 400, code: "email_not_confirmed" })).toMatch(/confirm/);
    expect(signInErrorMessage({ status: 429, code: "over_request_rate_limit" })).toMatch(/Muitas tentativas/);
  });
  it("uses a generic message otherwise", () => {
    expect(signInErrorMessage({ status: 500 })).toMatch(/Não foi possível entrar/);
  });
});
