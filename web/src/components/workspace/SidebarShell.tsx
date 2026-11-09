"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { TocGroup } from "@/lib/layout/toc";
import { DEFAULT_THEME } from "@/lib/theme/theme";
import { SidebarEditor } from "./SidebarEditor";
import { SpaceLogo } from "./ThemeScope";

interface SidebarShellProps {
  title: string;
  subtitle: string | null;
  logoUrl: string | null;
  orgSlug: string;
  clientSlug: string | null;
  editorToc: TocGroup[] | null;
  footer: React.ReactNode;
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

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

/** DBI mark with the platform's own colours (the space theme recolours brand variables). */
function DbiLogo() {
  const gradient = `linear-gradient(135deg, ${DEFAULT_THEME.primaryColor}, ${DEFAULT_THEME.secondaryColor})`;
  return (
    <span className="flex items-center gap-2 text-base font-extrabold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg" style={{ background: gradient }} aria-hidden>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round">
          <path d="M5 20V10M12 20V4M19 20v-7" />
        </svg>
      </span>
      DBI
    </span>
  );
}

const ICON_BUTTON = "grid size-9 place-items-center rounded-lg border border-line transition hover:bg-text/5";

/**
 * Light "table of contents" panel: fixed on desktop (collapsible with the hamburger button), a drawer on
 * mobile. Admins can flip it into the editor ("Organizar").
 */
export function SidebarShell({
  title, subtitle, logoUrl, orgSlug, clientSlug, editorToc, footer, content, children,
}: SidebarShellProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const pathname = usePathname();
  const spaceHref = `/${orgSlug}${clientSlug ? `/${clientSlug}` : ""}`;

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

  return (
    <>
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

      {collapsed && (
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
        <div className="flex items-center justify-between gap-2 border-b border-paper-line px-5 py-3">
          <Link href="/" aria-label="DBI — voltar à tela inicial" title="Voltar à tela inicial" className="rounded-md hover:opacity-80">
            <DbiLogo />
          </Link>
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

        <div className="px-5 pb-4 pt-5">
          <SpaceLogo url={logoUrl} className="mb-4 max-h-12 max-w-[200px]" />
          <Link href={spaceHref} className="block text-[19px] leading-tight hover:underline">
            {title}
          </Link>
          {subtitle && <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {editing && editorToc ? (
            <SidebarEditor
              orgSlug={orgSlug}
              clientSlug={clientSlug}
              toc={editorToc}
              onDone={() => setEditing(false)}
            />
          ) : (
            children
          )}
        </div>

        {!editing && (
          <div className="border-t border-paper-line px-5 py-4 text-sm">
            {editorToc && (
              <button type="button" onClick={() => setEditing(true)} className="mb-3 text-ink underline-offset-4 hover:underline">
                Organizar sumário
              </button>
            )}
            {footer}
          </div>
        )}
      </aside>

      <main
        className={`px-4 pb-16 transition-[margin] sm:px-8 lg:px-14 ${collapsed ? "lg:ml-0 lg:pt-10" : "lg:ml-[300px]"}`}
      >
        {content}
      </main>
    </>
  );
}
