import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden, OrgFrame, PageHeader } from "@/components/AppShell";
import { SectionTitle } from "@/components/DashboardLists";
import { CreateClientForm, GrantAccessForm } from "@/components/admin/AdminForms";
import { getOrgContext, orgActions, requireAction } from "@/lib/access";
import { listClients, listOrgPeople } from "@/lib/data/organizations";
import { guard } from "@/lib/guard";
import { ROLE_LABEL } from "@/lib/permissions";
import { revokeAccessAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administração" };

async function loadAdmin(orgSlug: string) {
  const ctx = await getOrgContext(orgSlug);
  requireAction(orgActions(ctx), "admin");
  const [clients, people] = await Promise.all([listClients(ctx.org.id), listOrgPeople(ctx.org.id)]);
  return { ctx, clients, people };
}

function RevokeButton({ org, userId, clientId, label }: { org: string; userId: string; clientId?: string; label: string }) {
  return (
    <form action={revokeAccessAction} className="inline">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="userId" value={userId} />
      {clientId && <input type="hidden" name="clientId" value={clientId} />}
      <button type="submit" title={label} aria-label={label} className="ml-1 text-muted hover:text-danger">×</button>
    </form>
  );
}

export default async function AdminPage({ params }: { params: Promise<{ org: string }> }) {
  const data = await guard(loadAdmin((await params).org));
  if (data === "forbidden") return <Forbidden message="Somente admins da organização acessam esta página." />;
  const { ctx, clients, people } = data;
  const org = ctx.org.slug;

  return (
    <OrgFrame org={ctx.org} isAdmin userName={ctx.user.name}>
      <PageHeader
        crumbs={[{ label: ctx.org.name, href: `/${org}` }]}
        eyebrow="Administração"
        title="Clientes e usuários"
        subtitle={`Organize quem acessa os dashboards de ${ctx.org.name} e de cada cliente.`}
        actions={<Link href={`/${org}/admin/aparencia`} className="btn btn-ghost">Aparência (cores e logo)</Link>}
      />

      <SectionTitle title="Clientes" subtitle="Cada cliente tem seu próprio endereço e só vê os próprios dashboards." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {clients.length === 0 ? (
            <div className="card p-6 text-sm text-muted">Nenhum cliente ainda.</div>
          ) : (
            <div className="card divide-y divide-line">
              {clients.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <Link href={`/${org}/${c.slug}`} className="font-semibold hover:text-brand-2">{c.name}</Link>
                    <p className="font-mono text-xs text-muted">dbi.app.br/{org}/{c.slug}</p>
                  </div>
                  <span className="text-xs text-muted">{c.dashboards} dashboards · {c.users} usuários</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <CreateClientForm orgSlug={org} />
      </div>

      <SectionTitle title="Usuários" subtitle="Equipe da organização e usuários dos clientes." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3 font-medium">Pessoa</th>
                <th className="px-4 py-3 font-medium">Organização</th>
                <th className="px-4 py-3 font-medium">Clientes</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.userId} className="border-b border-line/50 align-top last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{p.name}{p.userId === ctx.user.id && <span className="text-muted"> (você)</span>}</p>
                    <p className="text-xs text-muted">{p.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {p.orgRole ? (
                      <span className="inline-flex items-center rounded-md border border-line px-2 py-0.5 text-xs">
                        {ROLE_LABEL[p.orgRole]}
                        <RevokeButton org={org} userId={p.userId} label="Remover da equipe" />
                      </span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {p.clients.length === 0 && <span className="text-xs text-muted">—</span>}
                      {p.clients.map((c) => (
                        <span key={c.clientId} className="inline-flex items-center rounded-md border border-brand/40 px-2 py-0.5 text-xs">
                          {c.clientName}: {ROLE_LABEL[c.role]}
                          <RevokeButton org={org} userId={p.userId} clientId={c.clientId} label={`Remover de ${c.clientName}`} />
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <GrantAccessForm orgSlug={org} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>
    </OrgFrame>
  );
}
