import { describe, expect, it } from "vitest";
import { avatarHue, initials } from "./Avatar";

describe("initials", () => {
  it("uses the first and last names", () => {
    expect(initials("Ana Maria Souza")).toBe("AS");
    expect(initials("augusto")).toBe("AU");
  });

  it("ignores decorations like parentheses and keeps accents", () => {
    expect(initials("Ana (admin Odeon)")).toBe("AO");
    expect(initials("Érica Ávila")).toBe("ÉÁ");
  });

  it("falls back to the e-mail, then to ?", () => {
    expect(initials("", "zeca@x.com")).toBe("ZE");
    expect(initials("")).toBe("?");
  });
});

describe("avatarHue", () => {
  it("is stable and within 0–359", () => {
    expect(avatarHue("ana@x.com")).toBe(avatarHue("ana@x.com"));
    expect(avatarHue("ana@x.com")).toBeGreaterThanOrEqual(0);
    expect(avatarHue("ana@x.com")).toBeLessThan(360);
  });
});
