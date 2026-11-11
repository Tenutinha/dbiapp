import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Forbidden } from "@/components/AppShell";
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

  // Client-only users: straight to their first client; the others are in the switcher of the sidebar,
  // as everywhere else (no separate chooser page).
  const all = await listClients(ctx.org.id);
  const visible = new Set(visibleClientIds(ctx.membership, all.map((c) => c.id)));
  const first = all.find((c) => visible.has(c.id));
  if (first) redirect(`/${ctx.org.slug}/${first.slug}`);
  return <Forbidden message="Você ainda não tem acesso a nenhum espaço desta organização." />;
}
