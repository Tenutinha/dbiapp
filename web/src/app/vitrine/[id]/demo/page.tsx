import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/AppShell";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { MainHeader } from "@/components/workspace/Workspace";
import { loadSampleDashboard } from "@/lib/services/sample-dashboard";
import { ORIGIN_LABEL } from "@/lib/templates/labels";
import { getCatalogEntry } from "@/lib/templates/registry";
import type { Template } from "@/lib/templates/schema";
import { isVitrineTemplate } from "@/lib/vitrine";
import { getVitrineViewer } from "@/lib/vitrine-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pré-visualização · Vitrine", robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface Preview {
  template: Template;
  /** In the public showcase; otherwise only the platform admin is looking at it. */
  listed: boolean;
  /** The platform admin is looking: the header goes back to this dashboard's edit modal. */
  isPlatformAdmin: boolean;
}

const VALID_ID = /^[a-z0-9-]{1,80}$/;

/** Visitors preview what the showcase lists; the platform admin previews any catalog template. */
async function loadPreview(id: string): Promise<Preview> {
  if (!VALID_ID.test(id)) notFound();
  const entry = await getCatalogEntry(id);
  if (!entry) notFound();
  const listed = entry.status === "published" && isVitrineTemplate(entry.template);
  const isPlatformAdmin = (await getVitrineViewer())?.user.isPlatformAdmin === true;
  if (!listed && !isPlatformAdmin) notFound();
  return { template: entry.template, listed, isPlatformAdmin };
}

export default async function VitrineDemoPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { template, isPlatformAdmin } = await loadPreview(id);
  const { data, totalRows } = await loadSampleDashboard(template, await searchParams);
  const back = isPlatformAdmin
    ? { href: `/?editar=${template.id}#vitrine`, label: "Voltar à edição" }
    : { href: `/vitrine/${template.id}`, label: "Adicionar à minha organização" };

  return (
    <>
      <header className="border-b border-line/70">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-3 px-4 sm:px-8">
          <Logo />
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted sm:inline">
              Dados de exemplo fictícios
            </span>
            <Link href={back.href} className="btn btn-primary shrink-0 text-sm">{back.label}</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-8">
        <MainHeader
          kicker={`Pré-visualização · ${ORIGIN_LABEL[template.origin]} · ${template.area}`}
          meta="Dados de exemplo fictícios"
          title={template.name}
          lead={template.description}
        />
        <DashboardView template={template} data={data} totalRows={totalRows} />
      </main>
    </>
  );
}
