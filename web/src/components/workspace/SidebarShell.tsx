"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { TocGroup } from "@/lib/layout/toc";
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
  children: React.ReactNode;
}

/**
 * Light "table of contents" panel: fixed on desktop, a drawer on mobile.
 * Admins can flip it into the editor ("Organizar").
 */
export function SidebarShell({ title, subtitle, logoUrl, orgSlug, clientSlug, editorToc, footer, children }: SidebarShellProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer after navigating, including jumps to a section of the same page.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const close = (): void => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line/70 bg-bg/90 px-4 backdrop-blur lg:hidden">
        <Link href={`/${orgSlug}${clientSlug ? `/${clientSlug}` : ""}`} className="flex min-w-0 items-center gap-2 font-semibold">
          <SpaceLogo url={logoUrl} className="h-7 max-w-24 shrink-0" />
          <span className="truncate">{title}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="space-sidebar"
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
        >
          {open ? "Fechar" : "Sumário"}
        </button>
      </div>

      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <aside
        id="space-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-[300px] max-w-[85vw] flex-col bg-paper text-ink transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 pb-4 pt-6">
          <SpaceLogo url={logoUrl} className="mb-4 max-h-12 max-w-[200px]" />
          <Link href={`/${orgSlug}${clientSlug ? `/${clientSlug}` : ""}`} className="block text-[19px] leading-tight hover:underline">
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
    </>
  );
}
