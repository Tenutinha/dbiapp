"use client";

import { useEffect, useRef } from "react";

export interface MenuAction {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  actions: (MenuAction | "-")[];
  onClose: () => void;
}

/** Right-click menu at the pointer, kept inside the window; closes on a click outside, Esc or scroll. */
export function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 230);
  const top = Math.min(y, window.innerHeight - actions.length * 32 - 16);

  return (
    <div ref={ref} role="menu" style={{ left, top }} className="fixed z-50 w-[220px] rounded-lg border border-line bg-card p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)]">
      {actions.map((a, i) =>
        a === "-" ? (
          <hr key={`sep-${i}`} className="my-1 border-line" />
        ) : (
          <button
            key={a.label}
            type="button"
            role="menuitem"
            disabled={a.disabled}
            onClick={() => {
              onClose();
              a.onClick();
            }}
            className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-[13px] transition hover:bg-text/5 focus-visible:bg-text/5 focus-visible:outline-none disabled:opacity-40 ${a.danger ? "text-danger" : ""}`}
          >
            {a.label}
            {a.shortcut && <span className="text-[11px] text-muted">{a.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
