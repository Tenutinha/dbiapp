import Link from "next/link";
import { activateTemplate } from "@/app/actions";
import { ORIGIN_LABEL } from "@/lib/templates/labels";
import type { Template } from "@/lib/templates/schema";

/** A dashboard already activated in this space from a catalog template. */
export interface ActiveDashboard {
  id: string;
  published: boolean;
}

interface CatalogProps {
  templates: Template[];
  orgSlug: string;
  clientSlug?: string;
  targetLabel: string;
  /** templateId → dashboard already active in this space. */
  active?: Record<string, ActiveDashboard>;
}

export function Catalog({ templates, orgSlug, clientSlug, targetLabel, active = {} }: CatalogProps) {
  if (templates.length === 0) {
    return <p className="text-sm text-muted">Nenhum dashboard disponível no catálogo ainda.</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => (
        <article key={t.id} className="card flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between text-xs">
            <span className={`rounded-md px-2 py-0.5 font-semibold ${t.origin === "powerbi" ? "bg-accent/15 text-accent" : "bg-ok/15 text-ok"}`}>
              {ORIGIN_LABEL[t.origin]}
            </span>
            <span className="text-muted">{t.area}</span>
          </div>
          <h3 className="text-lg font-bold tracking-tight">{t.name}</h3>
          <p className="text-sm text-muted">{t.description}</p>
          <div className="flex flex-wrap gap-1.5">
            {t.tables.map((tb) => (
              <code
                key={tb.name}
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${tb.kind === "fact" ? "border-brand/50 text-brand" : "border-line text-muted"}`}
              >
                {tb.name}
              </code>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-2 pt-2">
            {active[t.id] && (
              <Link href={`/${orgSlug}/d/${active[t.id].id}/dados`} className="btn btn-primary w-full">
                {active[t.id].published ? "Já ativo · atualizar dados" : "Já ativo · subir dados"}
              </Link>
            )}
            <form action={activateTemplate}>
              <input type="hidden" name="templateId" value={t.id} />
              <input type="hidden" name="org" value={orgSlug} />
              {clientSlug && <input type="hidden" name="client" value={clientSlug} />}
              <button className="btn btn-ghost w-full" type="submit">
                {active[t.id] ? "Ativar outra cópia" : `Ativar para ${targetLabel}`}
              </button>
            </form>
          </div>
        </article>
      ))}
    </div>
  );
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4 mt-12 first:mt-0">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
    </div>
  );
}
