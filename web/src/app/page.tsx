import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, Notice, PageHeader } from "@/components/AppShell";
import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { NewOrgCard } from "@/components/NewOrgCard";
import { DeleteOrgButton } from "@/components/admin/DeleteOrgButton";
import { VitrineSection } from "@/components/vitrine/VitrineSection";
import { listUserOrganizations, type UserOrg } from "@/lib/access";
import { AccessError, getCurrentUser, type CurrentUser } from "@/lib/auth";
import { listCatalog } from "@/lib/data/catalog";
import { listAllOrganizations, type OrgOverview } from "@/lib/data/platform";
import { guard } from "@/lib/guard";
import { allowedActions, ROLE_LABEL } from "@/lib/permissions";
import { catalogReady, listTemplates } from "@/lib/templates/registry";
import { isVitrineTemplate, toVitrineItem, type VitrineItem } from "@/lib/vitrine";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "DBI — Dashboards prontos, é só engatar os dados" },
  description:
    "Dashboards de nível Power BI e QlikView no navegador, para a sua empresa e para os seus clientes. Suba Parquet ou CSV e compartilhe com a sua marca.",
};

/** Signed-in → the user's organizations; signed-out visitors → the public landing page. */
async function currentUserOrNull(): Promise<CurrentUser | null> {
  try {
    return await getCurrentUser();
  } catch (err) {
    if (err instanceof AccessError && err.status === 401) return null;
    throw err;
  }
}

/** Published showcase dashboards (Power BI / QlikView recreations only). */
async function loadVitrineItems(): Promise<VitrineItem[]> {
  const templates = await listTemplates();
  return templates.filter(isVitrineTemplate).map(toVitrineItem);
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

interface OrgCardProps {
  org: UserOrg;
  /** Platform admin only: counts for this organization. */
  stats?: OrgOverview;
  platformAdmin: boolean;
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/**
 * One organization on the home page: the whole card opens its dashboards; admins also get a
 * gear to its administration (a sibling link layered on top — links cannot be nested), and
 * platform administrators a trash can to delete it.
 */
function OrgCard({ org, stats, platformAdmin }: OrgCardProps) {
  const role = org.orgRole ? ROLE_LABEL[org.orgRole] : platformAdmin ? "Admin master" : "Acesso de cliente";
  const isAdmin = allowedActions({ orgRole: org.orgRole, clientRoles: {}, platformAdmin }, { clientId: null }).has("admin");
  return (
    <div className="card group relative p-5 transition hover:border-brand/60">
      <Link href={`/${org.slug}`} className="after:absolute after:inset-0 after:rounded-[inherit] after:content-['']">
        <p className={`text-lg font-bold group-hover:text-brand-2 ${platformAdmin ? "pr-16" : isAdmin ? "pr-8" : ""}`}>{org.name}</p>
      </Link>
      <p className="mt-1 font-mono text-xs text-muted">dbi.app.br/{org.slug}</p>
      <p className="mt-3 text-xs text-muted">{role}</p>
      {stats && (
        <p className="mt-1 text-xs text-muted">
          {plural(stats.clients, "cliente", "clientes")} · {plural(stats.dashboards, "dashboard", "dashboards")} ·{" "}
          {plural(stats.people, "pessoa", "pessoas")}
        </p>
      )}
      {platformAdmin && (
        <DeleteOrgButton
          org={{ id: org.id, name: org.name, slug: org.slug }}
          summary={stats ? `${plural(stats.clients, "cliente", "clientes")} · ${plural(stats.dashboards, "dashboard", "dashboards")} · ${plural(stats.people, "pessoa", "pessoas")}` : undefined}
        />
      )}
      {isAdmin && (
        <Link
          href={`/${org.slug}/admin`}
          title={`Administração de ${org.name}`}
          aria-label={`Administração de ${org.name}`}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted transition hover:bg-brand/15 hover:text-brand-2 focus-visible:text-brand-2"
        >
          <GearIcon />
        </Link>
      )}
    </div>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { editar } = await searchParams;
  // Other errors (403, DB down…) fall through to guard() below, which already knows how to show them.
  const signedIn = await currentUserOrNull().catch(() => undefined);
  if (signedIn === null) return <LandingPage vitrine={await loadVitrineItems()} />;
  const user = await guard(getCurrentUser());
  if (user === "forbidden") {
    return (
      <AppShell>
        <Notice tone="error">Seu e-mail ainda não tem acesso. Peça a um admin para te convidar.</Notice>
      </AppShell>
    );
  }
  const orgs = await listUserOrganizations(user.id, user.isPlatformAdmin);
  if (orgs.length === 1 && !user.isPlatformAdmin) redirect(`/${orgs[0].slug}`);

  const admin = user.isPlatformAdmin;
  const [items, catalogOk, overview] = await Promise.all([
    loadVitrineItems(),
    admin ? catalogReady() : Promise.resolve(false),
    admin ? listAllOrganizations() : Promise.resolve([]),
  ]);
  const catalogRows = catalogOk ? await listCatalog() : null;
  const statsById = new Map(overview.map((o) => [o.id, o]));

  return (
    <AppShell userName={user.name}>
      <PageHeader eyebrow={`Olá, ${user.name}`} title="Suas organizações" />
      {orgs.length === 0 && !admin ? (
        <Notice>Você ainda não faz parte de nenhuma organização. Peça ao admin para te dar acesso.</Notice>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((o) => (
            <OrgCard key={o.id} org={o} stats={statsById.get(o.id)} platformAdmin={admin} />
          ))}
          {admin && <NewOrgCard />}
        </div>
      )}
      <VitrineSection className="mt-12" items={items} admin={catalogRows ? { rows: catalogRows, editId: typeof editar === "string" ? editar : null } : null} />
    </AppShell>
  );
}
