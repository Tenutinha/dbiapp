import { describe, expect, it } from "vitest";
import {
  emailSchema,
  newPasswordSchema,
  passwordSchema,
  readSignupMetadata,
  safeNextPath,
  signInErrorMessage,
  signupSchema,
  slugCandidates,
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

describe("signupSchema", () => {
  const base = {
    name: "Ana Souza",
    company: "Odeon Tecnologia",
    slug: "",
    email: " Ana@Odeon.com ",
    password: "senha-forte-1",
    confirm: "senha-forte-1",
  };

  it("derives the address from the company name when left blank", () => {
    const r = signupSchema.parse(base);
    expect(r.slug).toBe("odeon-tecnologia");
    expect(r.email).toBe("ana@odeon.com");
  });
  it("keeps a custom address", () => {
    expect(signupSchema.parse({ ...base, slug: "Odeon" }).slug).toBe("odeon");
  });
  it("rejects reserved or malformed addresses", () => {
    expect(signupSchema.safeParse({ ...base, slug: "entrar" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, slug: "a b" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, company: "!!", slug: "" }).success).toBe(false);
  });
  it("requires name, company and a strong matching password", () => {
    expect(signupSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, company: "" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, confirm: "outra-senha-1" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, password: "curta1", confirm: "curta1" }).success).toBe(false);
  });
});

describe("slugCandidates", () => {
  it("tries the wanted address first, then numbered variants", () => {
    expect(slugCandidates("odeon", 3)).toEqual(["odeon", "odeon-2", "odeon-3"]);
  });
  it("keeps variants within the 40-char limit", () => {
    const long = "a".repeat(40);
    for (const s of slugCandidates(long, 12)) expect(s.length).toBeLessThanOrEqual(40);
  });
});

describe("readSignupMetadata", () => {
  it("reads what the signup form stored", () => {
    expect(readSignupMetadata({ name: "Ana", signup_org_name: "Odeon", signup_org_slug: "odeon" })).toEqual({
      name: "Ana",
      orgName: "Odeon",
      slug: "odeon",
    });
  });
  it("ignores accounts that did not come from the signup form", () => {
    expect(readSignupMetadata({})).toBeNull();
    expect(readSignupMetadata(undefined)).toBeNull();
    expect(readSignupMetadata({ name: "Ana", signup_org_name: "Odeon", signup_org_slug: "entrar" })).toBeNull();
  });
});
