import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, Notice, PageHeader } from "@/components/AppShell";
import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { listUserOrganizations } from "@/lib/access";
import { AccessError, getCurrentUser, type CurrentUser } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { ROLE_LABEL } from "@/lib/permissions";

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

export default async function HomePage() {
  // Other errors (403, DB down…) fall through to guard() below, which already knows how to show them.
  const signedIn = await currentUserOrNull().catch(() => undefined);
  if (signedIn === null) return <LandingPage />;
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

  return (
    <AppShell userName={user.name}>
      <PageHeader
        eyebrow={`Olá, ${user.name}`}
        title="Suas organizações"
        actions={
          <>
            <Link href="/vitrine" className="btn btn-ghost">Vitrine de dashboards</Link>
            {user.isPlatformAdmin && <Link href="/plataforma" className="btn btn-primary">Painel da plataforma</Link>}
          </>
        }
      />
      {orgs.length === 0 ? (
        <Notice>Você ainda não faz parte de nenhuma organização. Peça ao admin para te dar acesso.</Notice>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((o) => (
            <Link key={o.id} href={`/${o.slug}`} className="card group p-5 transition hover:border-brand/60">
              <p className="text-lg font-bold group-hover:text-brand-2">{o.name}</p>
              <p className="mt-1 font-mono text-xs text-muted">dbi.app.br/{o.slug}</p>
              <p className="mt-3 text-xs text-muted">{o.orgRole ? ROLE_LABEL[o.orgRole] : user.isPlatformAdmin ? "Admin master" : "Acesso de cliente"}</p>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
