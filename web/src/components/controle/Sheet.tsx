"use client";

import { useEffect, useRef } from "react";

interface SheetProps {
  /** Shown at the top; null keeps the sheet closed. */
  title: string | null;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * The sheet the "controle" forms open in: from the bottom on a phone, centred on a larger screen.
 * Its content only exists while it is open, so every opening starts clean.
 */
export function Sheet({ title, onClose, children }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = title !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-label={title ?? undefined}
      className="mx-auto mb-0 mt-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-card p-0 text-text backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:my-auto sm:rounded-2xl"
    >
      {open && (
        <div className="flex flex-col gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-2">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-10 place-items-center rounded-lg text-xl text-muted hover:bg-text/5">✕</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
