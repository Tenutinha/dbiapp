import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Forbidden, OrgFrame, PageHeader } from "@/components/AppShell";
import { SpaceHome } from "@/components/workspace/SpaceHome";
import { getOrgContext, orgActions } from "@/lib/access";
import { listClients } from "@/lib/data/organizations";
import { guard } from "@/lib/guard";
import { visibleClientIds } from "@/lib/permissions";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).org };
}

export default async function OrgHomePage({ params, searchParams }: Props) {
  const ctx = await guard(getOrgContext((await params).org));
  if (ctx === "forbidden") return <Forbidden />;

  if (orgActions(ctx).has("view")) {
    return (
      <SpaceHome org={ctx.org} client={null} membership={ctx.membership} user={ctx.user} searchParams={await searchParams} />
    );
  }

  // Client-only users: straight to their client, or a chooser when they have several.
  const all = await listClients(ctx.org.id);
  const visible = new Set(visibleClientIds(ctx.membership, all.map((c) => c.id)));
  const clients = all.filter((c) => visible.has(c.id));
  if (clients.length === 1) redirect(`/${ctx.org.slug}/${clients[0].slug}`);

  return (
    <OrgFrame org={ctx.org} userName={ctx.user.name}>
      <PageHeader eyebrow={ctx.org.name} title="Seus espaços" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {clients.map((c) => (
          <Link key={c.id} href={`/${ctx.org.slug}/${c.slug}`} className="card p-4 transition hover:border-brand/60">
            <p className="font-semibold">{c.name}</p>
            <p className="mt-1 font-mono text-xs text-muted">/{ctx.org.slug}/{c.slug}</p>
          </Link>
        ))}
      </div>
    </OrgFrame>
  );
}
