"use client";

import { useEffect, useState } from "react";
import { parseUiTheme, UI_THEME_KEY, type UiTheme } from "@/lib/theme/ui-theme";

function current(): UiTheme {
  return parseUiTheme(document.documentElement.dataset.theme) ?? "light";
}

/** Header button: switches the platform screens between light and dark and remembers it in this browser. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  // null until mounted: the server can't know the saved choice (the boot script already applied it).
  const [theme, setTheme] = useState<UiTheme | null>(null);
  useEffect(() => setTheme(current()), []);

  function toggle(): void {
    const next: UiTheme = current() === "dark" ? "light" : "dark";
    const html = document.documentElement;
    html.dataset.theme = next;
    html.style.colorScheme = next;
    try {
      localStorage.setItem(UI_THEME_KEY, next);
    } catch {
      // Storage blocked (private mode): the switch still works for this page view.
    }
    setTheme(next);
  }

  const label = theme === "dark" ? "Mudar para o tema claro" : "Mudar para o tema escuro";
  return (
    <button type="button" onClick={toggle} title={label} aria-label={label} className={className}>
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
