import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, Notice, PageHeader } from "@/components/AppShell";
import { TemplateJsonForm } from "@/components/admin/TemplateJsonForm";
import { getCurrentUser } from "@/lib/auth";
import { listCatalog, TEMPLATE_STATUSES } from "@/lib/data/catalog";
import { guard } from "@/lib/guard";
import { ORIGIN_LABEL, STATUS_CLASS, STATUS_LABEL } from "@/lib/templates/labels";
import { getCatalogEntry } from "@/lib/templates/registry";
import type { Template } from "@/lib/templates/schema";
import { deleteTemplateAction, setTemplateStatusAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard do catálogo" };

const STATUS_HINT = {
  draft: "Só a plataforma vê. Use para revisar antes de liberar.",
  published: "Organizações veem no catálogo e podem ativar.",
  archived: "Some do catálogo. Dashboards já ativos continuam funcionando.",
} as const;

function Contract({ template }: { template: Template }) {
  return (
    <div className="card p-5">
      <h2 className="font-semibold">Dados que a organização vai subir</h2>
      <p className="mt-1 text-xs text-muted">Um arquivo CSV ou Parquet por tabela, com estas colunas.</p>
      <div className="mt-4 flex flex-col gap-4">
        {template.tables.map((t) => (
          <div key={t.name}>
            <p className="text-sm">
              <code className={`font-mono ${t.kind === "fact" ? "text-brand" : "text-text"}`}>{t.name}</code>
              <span className="ml-2 text-xs text-muted">{t.kind === "fact" ? "fato" : `dimensão · chave ${t.key}`} — {t.description}</span>
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {t.columns.map((c) => (
                <code key={c.name} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">
                  {c.name}: {c.type}{c.required ? "" : "?"}
                </code>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        {template.measures.length} medidas · {template.visuals.length} visuais · {template.filters.length} filtros
      </p>
    </div>
  );
}

export default async function PlatformTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await guard(getCurrentUser());
  if (user === "forbidden" || !user.isPlatformAdmin) notFound();
  const { id } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(id)) notFound();

  const entry = await getCatalogEntry(id);
  if (!entry) notFound();
  const { template, status, builtIn } = entry;
  const usage = (await listCatalog()).find((r) => r.id === id)?.usage ?? 0;

  return (
    <AppShell userName={user.name}>
      <PageHeader
        crumbs={[{ label: "Início", href: "/" }, { label: "Vitrine", href: "/#vitrine" }]}
        eyebrow={`${template.area} · ${ORIGIN_LABEL[template.origin]} · v${template.version}${builtIn ? " · embutido" : ""}`}
        title={template.name}
        subtitle={template.description}
        actions={
          <a href={`/plataforma/catalogo/${id}/template.json`} className="btn btn-ghost" download>
            Baixar template.json
          </a>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <div className="card flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Disponibilidade</h2>
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
            </div>
            <p className="text-sm text-muted">{STATUS_HINT[status]} Em uso por {usage} dashboard(s).</p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_STATUSES.filter((s) => s !== status).map((s) => (
                <form key={s} action={setTemplateStatusAction}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value={s} />
                  <button className={s === "published" ? "btn btn-primary" : "btn btn-ghost"}>
                    {s === "published" ? "Publicar" : s === "draft" ? "Voltar para rascunho" : "Arquivar"}
                  </button>
                </form>
              ))}
              {!builtIn && usage === 0 && (
                <form action={deleteTemplateAction}>
                  <input type="hidden" name="id" value={id} />
                  <button className="btn btn-ghost text-danger">Excluir</button>
                </form>
              )}
            </div>
          </div>
          <Contract template={template} />
        </div>
        {builtIn ? (
          <Notice>
            Dashboard embutido: a definição vem do código (<code className="font-mono">web/templates/{id}</code>) e é
            atualizada a cada deploy. Aqui você controla só a disponibilidade.
          </Notice>
        ) : (
          <TemplateJsonForm mode="update" id={id} initialJson={JSON.stringify(template, null, 2)} />
        )}
      </div>
      <p className="mt-6 text-xs text-muted">
        <Link href="/#vitrine" className="hover:text-text">← Voltar à vitrine</Link>
      </p>
    </AppShell>
  );
}
