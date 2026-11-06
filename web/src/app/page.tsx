import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, Notice, PageHeader } from "@/components/AppShell";
import { listUserOrganizations } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { ROLE_LABEL } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
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
    <AppShell>
      <PageHeader
        eyebrow={`Olá, ${user.name}`}
        title="Suas organizações"
        actions={user.isPlatformAdmin && <Link href="/plataforma" className="btn btn-primary">Painel da plataforma</Link>}
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
