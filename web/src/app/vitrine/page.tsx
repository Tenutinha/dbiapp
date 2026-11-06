import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/AppShell";
import { VitrineFrame } from "@/components/vitrine/VitrineFrame";
import { ORIGIN_LABEL } from "@/lib/templates/labels";
import { listTemplates } from "@/lib/templates/registry";
import { filterVitrine, parseVitrineQuery, toVitrineItem, VITRINE_ORIGINS, vitrineAreas, type VitrineItem } from "@/lib/vitrine";
import { getVitrineViewer } from "@/lib/vitrine-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vitrine de dashboards",
  description: "Dashboards prontos de Power BI e QlikView recriados no navegador. Escolha, adicione à sua organização e suba seus dados.",
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function VitrinePage({ searchParams }: Props) {
  const query = parseVitrineQuery(await searchParams);
  const [templates, viewer] = await Promise.all([listTemplates(), getVitrineViewer()]);
  const all = templates.map(toVitrineItem);
  const items = filterVitrine(all, query);
  const filtered = Boolean(query.q || query.area || query.origin);

  return (
    <VitrineFrame viewer={viewer}>
      <PageHeader
        eyebrow="Vitrine"
        title="Dashboards prontos para a sua empresa"
        subtitle="Todos os dashboards criados na DBI. Abra um para ver as tabelas que ele espera e adicione à sua organização com um clique."
      />

      <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4" role="search">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">Buscar</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            maxLength={80}
            placeholder="Vendas, estoque, fato_vendas…"
            className="rounded-lg border border-line bg-bg px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Área</span>
          <select name="area" defaultValue={query.area ?? ""} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
            <option value="">Todas</option>
            {vitrineAreas(all).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Origem</span>
          <select name="origem" defaultValue={query.origin ?? ""} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
            <option value="">Todas</option>
            {VITRINE_ORIGINS.map((o) => (
              <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">Filtrar</button>
        {filtered && <Link href="/vitrine" className="btn btn-ghost">Limpar</Link>}
      </form>

      <p className="mb-4 text-xs text-muted">
        {items.length} {items.length === 1 ? "dashboard" : "dashboards"}
        {filtered ? ` de ${all.length}` : ""}
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-muted">
          {filtered ? "Nenhum dashboard encontrado com esses filtros." : "Nenhum dashboard publicado ainda."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <VitrineCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </VitrineFrame>
  );
}

function VitrineCard({ item }: { item: VitrineItem }) {
  return (
    <Link href={`/vitrine/${item.id}`} className="card group flex flex-col gap-3 p-5 transition hover:border-brand/60">
      <div className="flex items-center justify-between text-xs">
        <span className={`rounded-md px-2 py-0.5 font-semibold ${item.origin === "powerbi" ? "bg-accent/15 text-accent" : "bg-ok/15 text-ok"}`}>
          {ORIGIN_LABEL[item.origin]}
        </span>
        <span className="text-muted">{item.area}</span>
      </div>
      <h2 className="text-lg font-bold tracking-tight group-hover:text-brand-2">{item.name}</h2>
      <p className="text-sm text-muted">{item.description}</p>
      <div className="flex flex-wrap gap-1.5">
        {item.tables.map((t) => (
          <code key={t} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">{t}</code>
        ))}
      </div>
      <span className="mt-auto pt-2 text-sm font-semibold text-brand-2">Ver detalhes e adicionar →</span>
    </Link>
  );
}
