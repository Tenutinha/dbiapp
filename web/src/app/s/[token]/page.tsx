import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/AppShell";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { resolveShareToken } from "@/lib/data/repository";
import { MainHeader } from "@/components/workspace/Workspace";
import { SpaceLogo, ThemeScope } from "@/components/workspace/ThemeScope";
import { getEffectiveBranding } from "@/lib/data/branding";
import { formatDateLong, formatDateTime } from "@/lib/format";
import { isFiscalPanel } from "@/lib/fiscal/panel";
import { loadDashboard } from "@/lib/services/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard compartilhado", robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GuestPage({ params, searchParams }: Props) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const shared = await resolveShareToken(token);
  // The panel of fiscal data shows the space's files: it is never opened through a link.
  if (!shared?.activeVersionId || isFiscalPanel(shared.templateId)) notFound();

  const [{ template, data, totalRows }, branding] = await Promise.all([
    loadDashboard(shared.instanceId, shared.templateId, shared.activeVersionId, await searchParams),
    getEffectiveBranding(shared.orgId, shared.clientId),
  ]);

  return (
    <ThemeScope theme={branding.theme}>
      <header className="border-b border-line/70">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4 px-4 sm:px-8">
          {branding.logoUrl ? (
            <span className="flex min-w-0 items-center gap-3">
              <SpaceLogo url={branding.logoUrl} className="h-8 max-w-36" />
              <span className="truncate text-sm">{shared.orgName}</span>
            </span>
          ) : (
            <Logo />
          )}
          <span className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted">
            Somente leitura{shared.expiresAt ? ` · até ${formatDateTime(shared.expiresAt)}` : ""}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-8">
        <MainHeader
          kicker={`${shared.orgName} · ${template.area}`}
          meta={shared.publishedAt ? `Atualizado em ${formatDateLong(shared.publishedAt)}` : undefined}
          title={shared.name}
          lead={shared.description ?? template.description}
        />
        <DashboardView template={template} data={data} totalRows={totalRows} />
      </main>
    </ThemeScope>
  );
}
