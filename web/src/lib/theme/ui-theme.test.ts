import { describe, expect, it } from "vitest";
import { defaultUiTheme, parseUiTheme, themeBootScript, UI_THEME_KEY } from "./ui-theme";

describe("parseUiTheme", () => {
  it("accepts only light and dark", () => {
    expect(parseUiTheme("light")).toBe("light");
    expect(parseUiTheme("dark")).toBe("dark");
    expect(parseUiTheme("blue")).toBeNull();
    expect(parseUiTheme(null)).toBeNull();
  });
});

describe("defaultUiTheme", () => {
  it("is dark while developing and light in production", () => {
    expect(defaultUiTheme("development")).toBe("dark");
    expect(defaultUiTheme("production")).toBe("light");
    expect(defaultUiTheme(undefined)).toBe("light");
  });

  it("uses DBI_TEMA_PADRAO when it is a valid theme", () => {
    expect(defaultUiTheme("development", "light")).toBe("light");
    expect(defaultUiTheme("production", "dark")).toBe("dark");
    expect(defaultUiTheme("development", "roxo")).toBe("dark");
  });
});

describe("themeBootScript", () => {
  function run(stored: string | null, fallback: "light" | "dark", throws = false): string | undefined {
    const html: { dataset: Record<string, string>; style: Record<string, string> } = { dataset: {}, style: {} };
    const storage = {
      getItem: (k: string) => {
        if (throws) throw new Error("blocked");
        return k === UI_THEME_KEY ? stored : null;
      },
    };
    new Function("document", "localStorage", themeBootScript(fallback))({ documentElement: html }, storage);
    return html.dataset.theme;
  }

  it("applies the saved choice", () => {
    expect(run("light", "dark")).toBe("light");
  });

  it("falls back to the environment default when nothing (or garbage) is saved", () => {
    expect(run(null, "dark")).toBe("dark");
    expect(run("<script>", "light")).toBe("light");
  });

  it("still sets a theme when storage is blocked", () => {
    expect(run(null, "dark", true)).toBe("dark");
  });
});
