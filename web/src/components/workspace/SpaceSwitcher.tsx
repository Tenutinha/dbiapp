"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { filterSpaces, type SpaceOption } from "@/lib/space-options";

/** From this many spaces on, the menu gets a search field. */
const SEARCH_FROM = 7;

const SUBTITLE = "block truncate text-[13px] leading-snug";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Two-letter badge from the space's name ("Deputado Federal" → "DF"). */
function initials(label: string): string {
  const words = label.split(/\s+/).filter((w) => w.length > 2 || /^[A-ZÀ-Ú]/.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : label.slice(0, 2)).toUpperCase();
}

/**
 * Subtitle under the organization's name in the sidebar: the open space (the organization itself or
 * one of its segments/clients). With more than one accessible space it opens a small menu to switch —
 * a listbox styled like the sidebar, with arrow keys, Enter, Esc and a search when the list is long.
 */
export function SpaceSwitcher({ spaces }: { spaces: SpaceOption[] }) {
  const current = spaces.find((s) => s.current) ?? spaces[0];
  if (!current) return null;
  if (spaces.length <= 1) return <span className={`${SUBTITLE} mt-0.5 text-ink-muted`}>{current.label}</span>;
  return <SpaceMenu spaces={spaces} current={current} />;
}

function SpaceMenu({ spaces, current }: { spaces: SpaceOption[]; current: SpaceOption }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const withSearch = spaces.length >= SEARCH_FROM;
  const shown = filterSpaces(spaces, query);

  const close = (refocus: boolean): void => {
    setOpen(false);
    setQuery("");
    if (refocus) buttonRef.current?.focus();
  };

  const openMenu = (): void => {
    setActive(Math.max(0, spaces.indexOf(current)));
    setOpen(true);
  };

  const choose = (space: SpaceOption | undefined): void => {
    if (!space) return;
    close(true);
    if (!space.current) start(() => router.push(space.href));
  };

  // Focus the search (or the list) on open; close on any pointer down outside.
  useEffect(() => {
    if (!open) return;
    (withSearch ? searchRef.current : listRef.current)?.focus();
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, withSearch]);

  // Keep the highlighted option visible while moving with the keyboard.
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (shown.length === 0 ? 0 : (i + step + shown.length) % shown.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={rootRef} className="relative mt-0.5">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openMenu();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title="Trocar de espaço"
        disabled={pending}
        className={`-mx-1.5 flex max-w-[calc(100%+0.75rem)] items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-black/5 hover:text-ink disabled:cursor-wait ${open ? "bg-black/5 text-ink" : "text-ink-muted"}`}
      >
        <span className={`${SUBTITLE} min-w-0`}>{pending ? "Abrindo…" : current.label}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          onKeyDown={onKeyDown}
          className="absolute left-[-0.375rem] top-full z-50 mt-1.5 w-[248px] origin-top-left rounded-xl border border-paper-line bg-paper p-1.5 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)] transition duration-150 starting:-translate-y-1 starting:scale-95 starting:opacity-0"
        >
          {withSearch && (
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Buscar espaço…"
              aria-label="Buscar espaço"
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              className="mb-1.5 w-full rounded-lg border border-paper-line bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-ink-muted"
            />
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Espaços"
            aria-activedescendant={!withSearch && shown[active] ? `${listId}-${active}` : undefined}
            className="max-h-72 overflow-y-auto outline-none"
          >
            {shown.map((space, i) => (
              <li
                key={space.href}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={space.current}
                onPointerMove={() => setActive(i)}
                onClick={() => choose(space)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[14px] text-ink ${i === active ? "bg-black/[0.06]" : ""}`}
              >
                <span className={`grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-bold tracking-wide ${space.kind === "org" ? "bg-ink text-paper" : "bg-black/[0.07] text-ink-muted"}`} aria-hidden>
                  {initials(space.label)}
                </span>
                <span className={`min-w-0 flex-1 truncate ${space.current ? "font-semibold" : ""}`}>{space.label}</span>
                {space.current && <CheckIcon />}
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-3 text-center text-[13px] text-ink-muted">Nenhum espaço encontrado</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
