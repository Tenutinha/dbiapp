/**
 * Space branding → CSS custom properties. Pure, unit-tested, safe on client and server.
 *
 * A client space inherits every value its organization set and overrides only what it sets itself.
 * Text colours on top of admin-chosen backgrounds are derived for contrast, never chosen freely.
 */
import { z } from "zod";

export const HEX = /^#[0-9a-f]{6}$/;
const hex = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEX, "Use uma cor no formato #RRGGBB.");

export const APPEARANCES = ["dark", "light"] as const;
export type Appearance = (typeof APPEARANCES)[number];

/** What an admin can set for a space. null = not set here (inherit / default). */
export interface BrandingInput {
  primaryColor: string | null;
  secondaryColor: string | null;
  sidebarColor: string | null;
  appearance: Appearance | null;
  /** Background of the dashboard area (behind the cards). Null = the appearance's own background. */
  backgroundColor: string | null;
}

export const brandingInputSchema = z.object({
  primaryColor: hex.nullable(),
  secondaryColor: hex.nullable(),
  sidebarColor: hex.nullable(),
  appearance: z.enum(APPEARANCES).nullable(),
  backgroundColor: hex.nullable().default(null),
});

export interface Theme {
  primaryColor: string;
  secondaryColor: string;
  sidebarColor: string;
  appearance: Appearance;
  /** Null = the light or dark surfaces of `appearance`; set = surfaces derived from this colour. */
  backgroundColor: string | null;
}

export const DEFAULT_THEME: Theme = {
  primaryColor: "#7c5cff",
  secondaryColor: "#22d3ee",
  sidebarColor: "#f6f5f1",
  appearance: "dark",
  backgroundColor: null,
};

export const EMPTY_BRANDING: BrandingInput = {
  primaryColor: null, secondaryColor: null, sidebarColor: null, appearance: null, backgroundColor: null,
};

/** Most specific wins: client → organization → platform default. */
export function resolveTheme(...layers: readonly (BrandingInput | null | undefined)[]): Theme {
  const pick = <K extends keyof Theme>(key: K): Theme[K] => {
    for (const layer of layers) {
      const value = layer?.[key];
      if (value !== null && value !== undefined) return value as Theme[K];
    }
    return DEFAULT_THEME[key];
  };
  return {
    primaryColor: pick("primaryColor"),
    secondaryColor: pick("secondaryColor"),
    sidebarColor: pick("sidebarColor"),
    appearance: pick("appearance"),
    backgroundColor: pick("backgroundColor"),
  };
}

// ---------- colour maths ----------

function rgb(color: string): [number, number, number] {
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix `a` towards `b` by t (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

const INK_DARK = "#1c1c1a";
const INK_LIGHT = "#f5f5f4";

const best = (background: string, candidates: readonly string[]): string =>
  candidates.reduce((a, b) => (contrastRatio(background, b) > contrastRatio(background, a) ? b : a));

/**
 * Text colour for `background` with at least 4.5:1 (WCAG AA). Prefers soft off-black/off-white;
 * mid-tones fall back to pure black/white, which always reach ≥ 4.58:1.
 */
export function readableOn(background: string): string {
  const soft = best(background, [INK_DARK, INK_LIGHT]);
  return contrastRatio(background, soft) >= 4.5 ? soft : best(background, ["#000000", "#ffffff"]);
}

// ---------- CSS variables ----------

const SURFACES: Record<Appearance, Record<string, string>> = {
  dark: {
    "--color-bg": "#07090f",
    "--color-bg-2": "#0c1019",
    "--color-card": "#111623",
    "--color-card-2": "#161c2c",
    "--color-line": "#222a3d",
    "--color-text": "#e8ecf5",
    "--color-muted": "#8d97ad",
    "--chart-grid": "#1b2233",
    "--chart-axis": "#2c3550",
  },
  light: {
    "--color-bg": "#fbfbf9",
    "--color-bg-2": "#f3f2ee",
    "--color-card": "#ffffff",
    "--color-card-2": "#ffffff",
    "--color-line": "#e3e1da",
    "--color-text": "#17171a",
    "--color-muted": "#66666f",
    "--chart-grid": "#eeede8",
    "--chart-axis": "#d4d2ca",
  },
};

/** Below this luminance a chosen background counts as dark (cards get lighter, text light). */
const DARK_BACKGROUND = 0.18;

/** Light or dark, as the browser should treat the dashboard area: from the chosen background when there is one. */
export function effectiveAppearance(theme: Theme): Appearance {
  if (!theme.backgroundColor) return theme.appearance;
  return luminance(theme.backgroundColor) < DARK_BACKGROUND ? "dark" : "light";
}

/**
 * Surfaces derived from a chosen dashboard background: cards a bit lighter on a dark background and
 * almost white on a light one; text is the colour that reads best on both the background and the cards.
 */
function surfacesFrom(bg: string): Record<string, string> {
  const dark = luminance(bg) < DARK_BACKGROUND;
  const card = dark ? mix(bg, "#ffffff", 0.07) : mix(bg, "#ffffff", 0.7);
  const card2 = dark ? mix(bg, "#ffffff", 0.11) : mix(bg, "#ffffff", 0.85);
  const text = ["#17171a", "#e8ecf5", "#000000", "#ffffff"].reduce((best, c) =>
    Math.min(contrastRatio(bg, c), contrastRatio(card, c)) > Math.min(contrastRatio(bg, best), contrastRatio(card, best)) ? c : best,
  );
  return {
    "--color-bg": bg,
    "--color-bg-2": mix(bg, text, 0.04),
    "--color-card": card,
    "--color-card-2": card2,
    "--color-line": mix(card, text, 0.16),
    "--color-text": text,
    "--color-muted": mix(text, card, 0.4),
    "--chart-grid": mix(card, text, 0.08),
    "--chart-axis": mix(card, text, 0.2),
  };
}

/** All custom properties a themed subtree needs. Values are validated hex, safe for inline styles. */
export function themeCssVars(theme: Theme): Record<string, string> {
  const ink = readableOn(theme.sidebarColor);
  return {
    ...(theme.backgroundColor ? surfacesFrom(theme.backgroundColor) : SURFACES[theme.appearance]),
    "--color-brand": theme.primaryColor,
    "--color-brand-2": theme.secondaryColor,
    "--color-on-brand": readableOn(theme.primaryColor),
    "--color-paper": theme.sidebarColor,
    "--color-ink": ink,
    "--color-ink-muted": mix(ink, theme.sidebarColor, 0.42),
    "--color-paper-line": mix(ink, theme.sidebarColor, 0.82),
  };
}
