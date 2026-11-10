import type { FileStatus, Verdict } from "@/lib/storage-analysis";

/** Name and colours of each verdict (badges, icon dots and the filter). */
export const STATUS_STYLE: Record<FileStatus | "analyzing", { label: string; badge: string; dot: string }> = {
  ready: { label: "Pronto", badge: "bg-ok/15 text-ok", dot: "bg-ok" },
  treatment: { label: "Precisa de tratamento", badge: "bg-accent/15 text-accent", dot: "bg-accent" },
  unknown: { label: "Não reconhecido", badge: "bg-text/10 text-muted", dot: "bg-muted" },
  document: { label: "Documento", badge: "bg-text/10 text-muted", dot: "bg-muted" },
  deferred: { label: "Conferido no engate", badge: "bg-brand/10 text-brand-2", dot: "bg-brand" },
  analyzing: { label: "Analisando…", badge: "bg-brand/10 text-brand-2", dot: "bg-brand" },
};

/** The "Situação" cell: a coloured badge plus a short line; the whole detail goes in the tooltip. */
export function StatusBadge({ verdict, analyzing }: { verdict: Verdict | undefined; analyzing: boolean }) {
  if (!verdict) {
    return analyzing ? <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE.analyzing.badge}`}>Analisando…</span> : null;
  }
  const style = STATUS_STYLE[verdict.status];
  const outOfPlace = verdict.inStandard === false;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={verdict.detail}>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${style.badge}`}>{style.label}</span>
      {outOfPlace && <span className="shrink-0 rounded bg-danger/10 px-1 py-0.5 text-[10px] text-danger" title="Fora da pasta padrão">fora do padrão</span>}
      <span className="truncate text-[11px] text-muted">
        {verdict.readyFor?.map((r) => `${r.dashboard} › ${r.table}`).join(", ")
          ?? (verdict.buildIn?.length ? `Montar em ${verdict.buildIn.join(", ")}` : verdict.closest ? `falta ${verdict.closest.missing.join(", ")}` : "")}
      </span>
    </span>
  );
}
