import { describeBuild, type BuildStatus } from "@/lib/fiscal/build-status";

const TONE: Record<ReturnType<typeof describeBuild>["tone"], string> = {
  running: "border-brand-2/50 bg-brand-2/5",
  ok: "border-line",
  danger: "border-danger/50 bg-danger/5",
  warning: "border-accent/50 bg-accent/5",
};

/**
 * Where the last "Montar tabelas" of a dashboard stands, wherever it runs (also the script on a machine):
 * reading the files, putting each table together, done or failed — with a bar while it runs.
 */
export function BuildBanner({ status, now }: { status: BuildStatus; now: number }) {
  const d = describeBuild(status, now);
  return (
    <div className={`flex flex-col gap-1 rounded-md border p-3 ${TONE[d.tone]}`} role="status" aria-live="polite">
      <p className={`text-sm font-semibold ${d.tone === "danger" ? "text-danger" : d.tone === "warning" ? "text-accent" : ""}`}>
        {d.tone === "running" && <span aria-hidden className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-brand-2 align-middle" />}
        {d.title}
      </p>
      {d.progress !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.progress * 100)}>
          <div className="h-full bg-brand-2 transition-all" style={{ width: `${Math.round(d.progress * 100)}%` }} />
        </div>
      )}
      <p className="text-xs text-muted">{d.detail}</p>
    </div>
  );
}
