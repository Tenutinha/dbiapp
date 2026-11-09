"use client";

import { useRef } from "react";

interface CenteredModalProps {
  /** Accessible name of the dialog. */
  label: string;
  /** Renders whatever opens the modal (a button, a card…). */
  trigger: (open: () => void) => React.ReactNode;
  /** Modal content; receives `close` so a form can dismiss it after success. */
  children: (close: () => void) => React.ReactNode;
  /** Panel width in px (capped to the viewport). */
  width?: number;
  /** Called every time the modal opens (e.g. to load what it shows). */
  onOpen?: () => void;
}

/**
 * Native <dialog> shown in the middle of the screen over a dimmed backdrop.
 * Closes on the × button, Esc, or a click outside the panel.
 */
export function CenteredModal({ label, trigger, children, width = 640, onOpen }: CenteredModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = (): void => {
    dialogRef.current?.showModal();
    onOpen?.();
  };
  const close = (): void => dialogRef.current?.close();

  function onDialogClick(e: React.MouseEvent<HTMLDialogElement>): void {
    if (e.target === e.currentTarget) close();
  }

  return (
    <>
      {trigger(open)}
      <dialog
        ref={dialogRef}
        onClick={onDialogClick}
        aria-label={label}
        style={{ width: `min(${width}px, calc(100vw - 2rem))` }}
        className="m-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border-0 bg-transparent p-0 text-text backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <div className="relative">
          <button
            type="button"
            onClick={close}
            aria-label="Fechar"
            className="absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-line/40 hover:text-text"
          >
            ×
          </button>
          {children(close)}
        </div>
      </dialog>
    </>
  );
}
