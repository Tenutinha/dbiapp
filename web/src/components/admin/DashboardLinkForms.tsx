"use client";

import { useFormStatus } from "react-dom";
import { unlinkDashboardAction } from "@/app/[org]/admin/dashboard-actions";

function UnlinkSubmit({ name, compact }: { name: string; compact: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={compact ? `Tirar "${name}" daqui` : undefined}
      aria-label={compact ? `Tirar "${name}" daqui` : undefined}
      className={compact ? "ml-1 text-muted hover:text-danger" : "btn btn-ghost text-muted hover:text-danger"}
      onClick={(e) => {
        const ok = window.confirm(
          `Desvincular "${name}"?\n\nEle some da tela de visualização. Os dados ficam guardados: se você vincular de novo, eles voltam.`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      {compact ? (pending ? "…" : "×") : pending ? "Desvinculando…" : "Desvincular"}
    </button>
  );
}

/** Archives one linked dashboard after a confirmation. */
export function UnlinkDashboardButton({ orgSlug, instanceId, name, compact = false }: { orgSlug: string; instanceId: string; name: string; compact?: boolean }) {
  return (
    <form action={unlinkDashboardAction} className={compact ? "inline" : undefined}>
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="instanceId" value={instanceId} />
      <UnlinkSubmit name={name} compact={compact} />
    </form>
  );
}
