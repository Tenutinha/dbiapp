"use client";

import { useEffect, useRef } from "react";
import { ProfilePanel } from "./ProfilePanel";

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  passwordEnabled: boolean;
}

/**
 * "Meu perfil" in a centered modal (native <dialog>: focus trapped, Esc closes, click outside closes).
 * Rendered outside the user menu, which hides itself when closed.
 */
export function ProfileModal({ open, onClose, passwordEnabled }: ProfileModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label="Meu perfil"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      style={{ width: "min(640px, calc(100vw - 2rem))" }}
      className="m-auto max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-line bg-bg p-0 text-text shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="relative p-6">
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Fechar"
          className="absolute right-3 top-3 rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-text/5 hover:text-text"
        >
          ×
        </button>
        <h2 className="mb-4 text-lg font-bold">Meu perfil</h2>
        {/* Mounted only while open: the profile is (re)loaded every time it opens. */}
        {open && <ProfilePanel passwordEnabled={passwordEnabled} />}
      </div>
    </dialog>
  );
}
