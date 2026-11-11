import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { getOrgContext } from "@/lib/access";
import { guard } from "@/lib/guard";
import { orgAppName, orgManifestHref } from "@/lib/pwa";

interface Props {
  params: Promise<{ org: string }>;
  children: React.ReactNode;
}

/** Installed from an organization's pages, the app carries its name: "DBI-Controle". */
export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  try {
    const { org } = await getOrgContext((await params).org);
    const name = orgAppName(org.name);
    return {
      applicationName: name,
      appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
      manifest: orgManifestHref(org.slug, org.name),
    };
  } catch (err) {
    unstable_rethrow(err);
    return {}; // not a member: the layout below answers with the 404 page
  }
}

/** Every page under /<org> requires membership; non-members get the 404 page. Pages pick their own frame. */
export default async function OrgLayout({ params, children }: Props) {
  await guard(getOrgContext((await params).org));
  return children;
}
