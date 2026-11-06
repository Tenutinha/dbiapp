import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/AppShell";
import { AddToOrg } from "@/components/vitrine/AddToOrg";
import { VitrineFrame } from "@/components/vitrine/VitrineFrame";
import { ORIGIN_LABEL } from "@/lib/templates/labels";
import { getCatalogEntry } from "@/lib/templates/registry";
import type { Template } from "@/lib/templates/schema";
import { getVitrineViewer } from "@/lib/vitrine-server";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

const VALID_ID = /^[a-z0-9-]{1,80}$/;

const VISUAL_LABEL = { kpi: "Indicador", bar: "Barras", line: "Linha", donut: "Rosca", table: "Tabela" } as const;
const TYPE_LABEL = { integer: "inteiro", decimal: "decimal", text: "texto", date: "data", timestamp: "data e hora", boolean: "sim/não" } as const;

/** Only published templates are shown publicly — drafts and archived ones 404. */
async function loadPublished(id: string): Promise<Template> {
  if (!VALID_ID.test(id)) notFound();
  const entry = await getCatalogEntry(id);
  if (!entry || entry.status !== "published") notFound();
  return entry.template;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const template = await loadPublished(id);
  return { title: `${template.name} · Vitrine`, description: template.description };
}

export default async function VitrineDetailPage({ params }: Props) {
  const { id } = await params;
  const [template, viewer] = await Promise.all([loadPublished(id), getVitrineViewer()]);

  return (
    <VitrineFrame viewer={viewer}>
      <PageHeader
        crumbs={[{ label: "Vitrine", href: "/vitrine" }, { label: template.area }]}
        eyebrow={`${ORIGIN_LABEL[template.origin]} · ${template.area}`}
        title={template.name}
        subtitle={template.description}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="O que você vê no dashboard">
            <ul className="grid gap-2 sm:grid-cols-2">
              {template.visuals.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                  <span className="truncate">{v.title}</span>
                  <span className="shrink-0 text-xs text-muted">{VISUAL_LABEL[v.type]}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Indicadores calculados">
            <div className="flex flex-wrap gap-1.5">
              {template.measures.map((m) => (
                <span key={m.id} className="rounded-md bg-white/5 px-2 py-1 text-xs">{m.label}</span>
              ))}
            </div>
          </Section>

          <Section title="Tabelas que você precisa subir">
            <div className="flex flex-col gap-4">
              {template.tables.map((tb) => (
                <div key={tb.name} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className={`font-mono text-sm font-semibold ${tb.kind === "fact" ? "text-brand" : "text-text"}`}>{tb.name}</code>
                    <span className="text-xs text-muted">{tb.kind === "fact" ? "fato" : "dimensão"}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{tb.description}</p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-muted">
                        <tr>
                          <th className="py-1 pr-4 font-medium">Coluna</th>
                          <th className="py-1 pr-4 font-medium">Tipo</th>
                          <th className="py-1 font-medium">Obrigatória</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tb.columns.map((c) => (
                          <tr key={c.name} className="border-t border-line/60">
                            <td className="py-1 pr-4 font-mono">{c.name}</td>
                            <td className="py-1 pr-4 text-muted">{TYPE_LABEL[c.type]}</td>
                            <td className="py-1 text-muted">{c.required ? "sim" : "não"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="card flex flex-col gap-3 p-5">
            <h2 className="text-base font-bold">Adicionar à sua organização</h2>
            <AddToOrg templateId={template.id} viewer={viewer} />
          </div>
        </aside>
      </div>
    </VitrineFrame>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}
