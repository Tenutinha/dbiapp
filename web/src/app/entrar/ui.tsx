import type { ReactNode } from "react";

/** Form pieces shared by the login, reset and new-password screens (safe in client components). */

export const INPUT_CLASS =
  "rounded-lg border border-line bg-bg px-3 py-2.5 text-sm text-text outline-none focus:border-brand";

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
      {children}
    </p>
  );
}

export function FormMessage({ ok, message }: { ok: boolean; message: string }) {
  if (!message) return null;
  return (
    <p role={ok ? "status" : "alert"} className={`text-sm ${ok ? "text-ok" : "text-danger"}`}>
      {message}
    </p>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      <span className="flex items-center justify-between">
        {label}
        {hint}
      </span>
      {children}
    </label>
  );
}
