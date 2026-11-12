"use client";

import { useEffect, useRef } from "react";

interface FormModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Wider for the editors that show lists side by side (files, fields). */
  wide?: boolean;
}

/**
 * Centered modal over the dashboard form (it opens in the top layer, above the catalog modal).
 * Edits apply to the form right away; "Salvar alterações" in the form still saves them.
 */
export function FormModal({ title, subtitle, onClose, children, wide = false }: FormModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] flex-col rounded-xl border border-line bg-card p-0 text-text shadow-2xl backdrop:bg-black/50 ${
        wide ? "max-w-5xl" : "max-w-2xl"
      }`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-line/40 hover:text-text">
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      <footer className="flex justify-end border-t border-line px-5 py-3">
        <button type="button" onClick={onClose} className="btn btn-primary">Pronto</button>
      </footer>
    </dialog>
  );
}
