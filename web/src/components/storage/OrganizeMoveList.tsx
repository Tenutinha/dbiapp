"use client";

import { useEffect, useRef, useState } from "react";
import type { OrganizeMove } from "@/lib/services/file-analysis";

/** Rows rendered at first and added each time the end of the list scrolls into view. */
export const MOVE_PAGE = 100;

interface OrganizeMoveListProps {
  moves: readonly OrganizeMove[];
  chosen: ReadonlySet<string>;
  onToggle: (path: string) => void;
}

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * The preview's moves with infinite scroll: a folder can hold thousands of fiscal files, and drawing every
 * row at once made the dialog slow to appear. Rows past the visible ones are added as the list scrolls.
 */
export function OrganizeMoveList({ moves, chosen, onToggle }: OrganizeMoveListProps) {
  const [shown, setShown] = useState(MOVE_PAGE);
  const end = useRef<HTMLLIElement>(null);
  const more = shown < moves.length;

  useEffect(() => {
    const el = end.current;
    if (!el || !more) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => Math.min(n + MOVE_PAGE, moves.length));
    }, { rootMargin: "300px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, moves.length, shown]);

  return (
    <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
      {moves.slice(0, shown).map((m) => (
        <li key={m.path} className="flex items-start gap-3 px-3 py-2">
          <input type="checkbox" checked={chosen.has(m.path)} onChange={() => onToggle(m.path)} aria-label={`Organizar ${fileName(m.path)}`} className="mt-1" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={m.path}>{fileName(m.path)}</p>
            <p className="truncate text-xs text-muted">{m.layout}</p>
            <p className="truncate font-mono text-[11px] text-muted" title={m.to}>→ {m.to}</p>
            {m.note && <p className="text-[11px] text-accent">⚠ {m.note}</p>}
          </div>
          {m.replaces && <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent" title="Já existe o mesmo documento na pasta: ele será substituído por este">substitui o existente</span>}
        </li>
      ))}
      {more && (
        <li ref={end} className="px-3 py-2 text-center text-xs text-muted">
          Mostrando {shown} de {moves.length} — role para ver mais
        </li>
      )}
    </ul>
  );
}
