/**
 * The viewer's own light/dark choice for the platform screens (home, admin, catalog…).
 *
 * Saved per browser in localStorage, which on localhost is also per port — so the dev server
 * and the real-data server keep separate choices. Without a choice: DBI_TEMA_PADRAO when set
 * ("light" | "dark"), otherwise dark while developing and light in production.
 * Dashboards keep the appearance their space's admin chose (ThemeScope).
 */
export const UI_THEMES = ["light", "dark"] as const;
export type UiTheme = (typeof UI_THEMES)[number];

export const UI_THEME_KEY = "dbi-tema";

export function parseUiTheme(value: unknown): UiTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function defaultUiTheme(nodeEnv: string | undefined, configured?: string): UiTheme {
  return parseUiTheme(configured) ?? (nodeEnv === "development" ? "dark" : "light");
}

/**
 * Inline script for <head>: sets <html data-theme> before the first paint (no flash of the wrong theme).
 * `fallback` is one of two literals, so the generated code never embeds untrusted input.
 */
export function themeBootScript(fallback: UiTheme): string {
  const safeFallback = parseUiTheme(fallback) ?? "light";
  return `(function(){var t=null;try{t=localStorage.getItem(${JSON.stringify(UI_THEME_KEY)})}catch(e){}`
    + `if(t!=="light"&&t!=="dark")t=${JSON.stringify(safeFallback)};`
    + `document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t})()`;
}
