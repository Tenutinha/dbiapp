import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Forbidden } from "@/components/AppShell";
import { SpaceHome } from "@/components/workspace/SpaceHome";
import { getClientContext } from "@/lib/access";
import { guard } from "@/lib/guard";
import { firstItem } from "@/lib/layout/toc";
import { controleEnabled } from "@/lib/services/controle";
import { loadSpace } from "@/lib/services/space";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ org: string; client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).client };
}

export default async function ClientHomePage({ params, searchParams }: Props) {
  const { org, client } = await params;
  const ctx = await guard(getClientContext(org, client));
  if (ctx === "forbidden") return <Forbidden />;
  // With the "controle" module on, a client that has no dashboard to show opens on its entries screen.
  if (await controleEnabled(ctx.org.id)) {
    const space = await loadSpace(ctx.org, ctx.client, ctx.membership);
    if (!firstItem(space.toc)) redirect(`/${ctx.org.slug}/${ctx.client.slug}/controle`);
  }
  return (
    <SpaceHome org={ctx.org} client={ctx.client} membership={ctx.membership} user={ctx.user} searchParams={await searchParams} />
  );
}
