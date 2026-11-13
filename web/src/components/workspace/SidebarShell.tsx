"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DbiMark } from "@/components/brand/DbiMark";
import type { SpaceOption } from "@/lib/space-options";
import { SidebarContext, type SidebarState } from "./sidebar-context";
import { SpaceSwitcher } from "./SpaceSwitcher";
import { SpaceLogo } from "./ThemeScope";

interface SidebarShellProps {
  /** Name of the open space (mobile top bar). */
  title: string;
  /** The organization, shown at the top of the panel; href null when this person can't open its own page. */
  org: { name: string; href: string | null };
  /** Spaces this person can open here (client switcher under the logo). */
  spaces: SpaceOption[];
  logoUrl: string | null;
  orgSlug: string;
  clientSlug: string | null;
  /** Where the space's name leads (default: the space's own address; a public link keeps its own). */
  homeHref?: string;
  footer: React.ReactNode;
  /** The signed-in person's avatar and menu, handed to the dashboard header through the context. */
  account?: React.ReactNode;
  /** The page itself, shown to the right of the panel (full width when the panel is collapsed). */
  content: React.ReactNode;
  children: React.ReactNode;
}

/** Remembered per browser; storage may be unavailable (private mode), so every access is guarded. */
const COLLAPSED_KEY = "dbi:sumario-recolhido";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // not persisted: the panel still toggles for this visit
  }
}

export function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

/** DBI mark with the platform's own colours (the space theme recolours brand variables). */
export function DbiLogo() {
  return (
    <span className="flex items-center gap-2 text-base font-extrabold tracking-tight">
      <DbiMark />
      DBI
    </span>
  );
}

export const ICON_BUTTON = "grid size-9 place-items-center rounded-lg border border-line transition hover:bg-text/5";

/**
 * Light "table of contents" panel: fixed on desktop (collapsible with the hamburger button), a drawer on
 * mobile. The summary is organized in the admin (/<org>/admin?sumario=…), not here.
 */
export function SidebarShell({
  title, org, spaces, logoUrl, orgSlug, clientSlug, homeHref, footer, account = null, content, children,
}: SidebarShellProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const spaceHref = homeHref ?? `/${orgSlug}${clientSlug ? `/${clientSlug}` : ""}`;

  useEffect(() => setCollapsed(readCollapsed()), []);
  // Close the mobile drawer after navigating, including jumps to a section of the same page.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const close = (): void => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  const toggleCollapsed = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    saveCollapsed(next);
  };

  // Bars on top of the page that took over the "open the panel" button (the dashboard header).
  const [hosts, setHosts] = useState(0);
  const hostToggle = useCallback(() => {
    setHosts((n) => n + 1);
    return () => setHosts((n) => n - 1);
  }, []);
  const expand = useCallback(() => {
    setCollapsed(false);
    saveCollapsed(false);
  }, []);
  const sidebar = useMemo<SidebarState>(
    () => ({ collapsed, expand, logoUrl, account, hostToggle }),
    [collapsed, expand, logoUrl, account, hostToggle],
  );
  const hosted = hosts > 0;

  return (
    <SidebarContext.Provider value={sidebar}>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line/70 bg-bg/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="space-sidebar"
          aria-label={open ? "Fechar sumário" : "Abrir sumário"}
          className={ICON_BUTTON}
        >
          <HamburgerIcon />
        </button>
        <Link href={spaceHref} className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
          <SpaceLogo url={logoUrl} className="h-7 max-w-24 shrink-0" />
          <span className="truncate">{title}</span>
        </Link>
      </div>

      {collapsed && !hosted && (
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={false}
          aria-controls="space-sidebar"
          aria-label="Abrir sumário"
          className={`${ICON_BUTTON} fixed left-4 top-4 z-30 hidden bg-bg/90 backdrop-blur lg:grid`}
        >
          <HamburgerIcon />
        </button>
      )}

      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <aside
        id="space-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-[300px] max-w-[85vw] flex-col bg-paper text-ink transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:-translate-x-full" : "lg:translate-x-0"}`}
      >
        {/* The space's logo opens the panel, centred; the collapse button sits beside the name below it. */}
        {logoUrl && (
          <div className="px-5 pb-1 pt-5">
            <SpaceLogo url={logoUrl} className="mx-auto block max-h-14 max-w-[220px]" />
          </div>
        )}

        <div className="flex items-start justify-between gap-2 border-b border-paper-line px-5 py-3">
          <div className="min-w-0 pt-1">
            {org.href ? (
              <Link href={org.href} className="block truncate text-base font-bold leading-tight tracking-tight hover:underline" title={org.name}>
                {org.name}
              </Link>
            ) : (
              <span className="block truncate text-base font-bold leading-tight tracking-tight" title={org.name}>{org.name}</span>
            )}
            <SpaceSwitcher spaces={spaces} />
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded
            aria-controls="space-sidebar"
            aria-label="Recolher sumário"
            title="Recolher sumário"
            className="hidden size-9 place-items-center rounded-lg text-ink-muted transition hover:bg-black/5 hover:text-ink lg:grid"
          >
            <HamburgerIcon />
          </button>
        </div>

        <div className="pt-4" />

        {/* data-summary-scroll: the outline scrolls this area to keep the analysis on screen in sight. */}
        <div data-summary-scroll className="scroll-quiet min-h-0 flex-1 overflow-y-auto pb-6 pl-5 pr-3">{children}</div>

        <div className="border-t border-paper-line px-5 py-4 text-sm">{footer}</div>
      </aside>

      <main
        className={`px-4 pb-16 transition-[margin] sm:px-8 lg:px-14 ${collapsed ? (hosted ? "lg:ml-0" : "lg:ml-0 lg:pt-10") : "lg:ml-[300px]"}`}
      >
        {content}
      </main>
    </SidebarContext.Provider>
  );
}
