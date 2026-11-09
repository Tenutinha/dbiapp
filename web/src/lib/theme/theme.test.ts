import { describe, expect, it } from "vitest";
import { checkLogo, detectLogoType } from "./logo";
import {
  brandingInputSchema, contrastRatio, DEFAULT_THEME, effectiveAppearance, EMPTY_BRANDING, mix, readableOn, resolveTheme,
  themeCssVars,
} from "./theme";

describe("resolveTheme", () => {
  it("falls back to the platform default", () => {
    expect(resolveTheme(null, EMPTY_BRANDING)).toEqual(DEFAULT_THEME);
  });

  it("client overrides only what it sets; the rest comes from the organization", () => {
    const org = { primaryColor: "#0055ff", secondaryColor: "#ff9900", sidebarColor: null, appearance: "light" as const, backgroundColor: "#eef2ff" };
    const client = { primaryColor: "#cc0000", secondaryColor: null, sidebarColor: null, appearance: null, backgroundColor: null };
    expect(resolveTheme(client, org)).toEqual({
      primaryColor: "#cc0000", secondaryColor: "#ff9900", sidebarColor: DEFAULT_THEME.sidebarColor, appearance: "light",
      backgroundColor: "#eef2ff",
    });
  });
});

describe("contrast", () => {
  it.each(["#ffffff", "#f6f5f1", "#ffd400", "#000000", "#0b1f4b", "#7c5cff", "#e11d48", "#22d3ee"])(
    "text chosen for %s keeps at least 4.5:1",
    (bg) => expect(contrastRatio(bg, readableOn(bg))).toBeGreaterThanOrEqual(4.5),
  );

  it("mix interpolates", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("themeCssVars", () => {
  it("derives sidebar text from the sidebar colour", () => {
    const darkSidebar = themeCssVars({ ...DEFAULT_THEME, sidebarColor: "#0b1f4b" });
    expect(darkSidebar["--color-ink"]).toBe("#f5f5f4");
    const lightSidebar = themeCssVars(DEFAULT_THEME);
    expect(lightSidebar["--color-ink"]).toBe("#1c1c1a");
  });

  it("switches content surfaces with the appearance", () => {
    expect(themeCssVars({ ...DEFAULT_THEME, appearance: "light" })["--color-bg"]).toBe("#fbfbf9");
    expect(themeCssVars(DEFAULT_THEME)["--color-bg"]).toBe("#07090f");
  });

  it("only ever emits hex colours (safe for inline styles)", () => {
    Object.values(themeCssVars(DEFAULT_THEME)).forEach((v) => expect(v).toMatch(/^#[0-9a-f]{6}$/));
    Object.values(themeCssVars({ ...DEFAULT_THEME, backgroundColor: "#123456" })).forEach((v) => expect(v).toMatch(/^#[0-9a-f]{6}$/));
  });
});

describe("dashboard background colour", () => {
  it.each(["#ffffff", "#f3efe6", "#0b1f4b", "#1e293b", "#7c5cff", "#ffd400"])(
    "builds readable surfaces on %s",
    (bg) => {
      const v = themeCssVars({ ...DEFAULT_THEME, backgroundColor: bg });
      expect(v["--color-bg"]).toBe(bg);
      expect(contrastRatio(v["--color-bg"], v["--color-text"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(v["--color-card"], v["--color-text"])).toBeGreaterThanOrEqual(4.5);
      // Cards stand out from the background (a white background keeps white cards, outlined by the border).
      expect(v["--color-line"]).not.toBe(v["--color-card"]);
      if (bg !== "#ffffff") expect(v["--color-card"]).not.toBe(bg);
    },
  );

  it("decides light or dark from the colour itself", () => {
    expect(effectiveAppearance({ ...DEFAULT_THEME, appearance: "dark", backgroundColor: "#ffffff" })).toBe("light");
    expect(effectiveAppearance({ ...DEFAULT_THEME, appearance: "light", backgroundColor: "#0b1f4b" })).toBe("dark");
    expect(effectiveAppearance({ ...DEFAULT_THEME, appearance: "light" })).toBe("light");
  });

  it("is validated like the other colours", () => {
    expect(brandingInputSchema.safeParse({ ...EMPTY_BRANDING, backgroundColor: "url(x)" }).success).toBe(false);
    expect(brandingInputSchema.parse({ ...EMPTY_BRANDING, backgroundColor: "#ABCDEF" }).backgroundColor).toBe("#abcdef");
  });
});

describe("brandingInputSchema", () => {
  it("normalises case and rejects anything that is not #rrggbb", () => {
    expect(brandingInputSchema.parse({ ...EMPTY_BRANDING, primaryColor: "#AABBCC" }).primaryColor).toBe("#aabbcc");
    for (const bad of ["red", "#abc", "#aabbccdd", "#zzzzzz", "#fff;}body{display:none", "url(x)"]) {
      expect(brandingInputSchema.safeParse({ ...EMPTY_BRANDING, primaryColor: bad }).success).toBe(false);
    }
  });
});

describe("logo checks", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

  it("detects raster formats by magic bytes", () => {
    expect(detectLogoType(png)).toBe("image/png");
    expect(detectLogoType(jpg)).toBe("image/jpeg");
    expect(detectLogoType(webp)).toBe("image/webp");
  });

  it("rejects SVG, empty and oversized files", () => {
    expect(checkLogo(svg)).toEqual({ ok: false, error: "Envie o logo em PNG, JPG ou WebP." });
    expect(checkLogo(new Uint8Array())).toMatchObject({ ok: false });
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(png);
    expect(checkLogo(big)).toEqual({ ok: false, error: "O logo deve ter no máximo 1 MB." });
  });
});
