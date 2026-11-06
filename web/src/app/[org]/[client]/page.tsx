import type { Metadata } from "next";
import { Forbidden } from "@/components/AppShell";
import { SpaceHome } from "@/components/workspace/SpaceHome";
import { getClientContext } from "@/lib/access";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ org: string; client: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).client };
}

export default async function ClientHomePage({ params }: Props) {
  const { org, client } = await params;
  const ctx = await guard(getClientContext(org, client));
  if (ctx === "forbidden") return <Forbidden />;
  return <SpaceHome org={ctx.org} client={ctx.client} membership={ctx.membership} user={ctx.user} />;
}
