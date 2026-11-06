import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, Notice, PageHeader } from "@/components/AppShell";
import { listUserOrganizations } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  const orgs = await listUserOrganizations(user.id);
  if (orgs.length === 1) redirect(`/${orgs[0].slug}`);

  return (
    <AppShell>
      <PageHeader eyebrow={`Olá, ${user.name}`} title="Suas organizações" />
      {orgs.length === 0 ? (
        <Notice>Você ainda não faz parte de nenhuma organização. Peça ao admin para te dar acesso.</Notice>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orgs.map((o) => (
            <Link key={o.id} href={`/${o.slug}`} className="card group p-5 transition hover:border-brand/60">
              <p className="text-lg font-bold group-hover:text-brand-2">{o.name}</p>
              <p className="mt-1 font-mono text-xs text-muted">dbi.app.br/{o.slug}</p>
              <p className="mt-3 text-xs text-muted">{o.orgRole ? ROLE_LABEL[o.orgRole] : "Acesso de cliente"}</p>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
