"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** Gives up after this long (the page may have failed; the bar must not stay forever). */
const MAX_MS = 20_000;

/**
 * A click on a link that will make Next ask the server for another page (or the same page with other
 * params). Next's own <Link> cancels the browser default to navigate itself, so defaultPrevented says
 * nothing here; links that open something in the browser only carry data-no-progress instead.
 */
function isNavigation(e: MouseEvent): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.("a");
  if (!a || !a.href || a.target === "_blank" || a.hasAttribute("download") || a.hasAttribute("data-no-progress")) return false;
  const to = new URL(a.href, window.location.href);
  if (to.origin !== window.location.origin) return false;
  // Only the hash changes: the browser scrolls, nothing loads.
  return to.pathname !== window.location.pathname || to.search !== window.location.search;
}

/**
 * Thin animated bar at the top (and a "progress" cursor) from the click on a link until the new page
 * arrives, so a slow server answer never looks like a click that did nothing.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (isNavigation(e)) setBusy(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The new page (or params) arrived.
  useEffect(() => setBusy(false), [pathname, search]);

  useEffect(() => {
    if (!busy) return;
    document.documentElement.style.cursor = "progress";
    const giveUp = setTimeout(() => setBusy(false), MAX_MS);
    return () => {
      clearTimeout(giveUp);
      document.documentElement.style.cursor = "";
    };
  }, [busy]);

  if (!busy) return null;
  return (
    <div role="progressbar" aria-label="Carregando" className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647] h-[3px] overflow-hidden">
      <div className="dbi-nav-progress h-full bg-gradient-to-r from-brand via-brand-2 to-brand" />
    </div>
  );
}
