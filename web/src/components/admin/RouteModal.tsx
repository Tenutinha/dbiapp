"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export interface RouteModalTab {
  href: string;
  label: string;
  active: boolean;
}

interface RouteModalProps {
  /** Where closing goes back to (the admin page without the modal's query param). */
  closeHref: string;
  /** Small line above the title, e.g. "Dados · Cliente 1". */
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Buttons next to the close button. */
  actions?: React.ReactNode;
  /** Sibling views to switch between (shown when there is more than one). */
  tabs?: RouteModalTab[];
  tabsLabel?: string;
  /** Max width in px (capped to the viewport). */
  width?: number;
  /**
   * Closing without asking the server for the page again (a modal opened in the browser only, like
   * "Arquivos"): replaces the address in place instead of navigating to closeHref.
   */
  onClosed?: () => void;
  children: React.ReactNode;
}

/**
 * Centered, focused dialog over the admin table, opened by a query param (?dados=…, ?tema=…) so it has
 * its own link and its content renders on the server. Native <dialog>: focus is trapped and Esc closes;
 * closing (×, Esc or a click outside) drops the param.
 */
export function RouteModal({ closeHref, eyebrow, title, subtitle, actions, tabs = [], tabsLabel, width = 1320, onClosed, children }: RouteModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={`${eyebrow} — ${title}`}
      onClose={() => (onClosed ? onClosed() : router.replace(closeHref, { scroll: false }))}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      style={{ width: `min(${width}px, calc(100vw - 2rem))` }}
      className="m-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-line bg-bg p-0 text-text shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-line bg-bg/95 px-6 py-4 backdrop-blur">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-2">{eyebrow}</p>
          <h2 className="truncate text-lg font-bold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Fechar"
            className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-text/5 hover:text-text"
          >
            ×
          </button>
        </div>
        {tabs.length > 1 && (
          <nav aria-label={tabsLabel} className="-mb-4 flex w-full gap-1 overflow-x-auto overflow-y-hidden text-sm">
            {tabs.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                replace
                scroll={false}
                aria-current={t.active ? "page" : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 ${t.active ? "border-brand font-semibold text-text" : "border-transparent text-muted hover:text-text"}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <div className="p-6">{children}</div>
    </dialog>
  );
}
