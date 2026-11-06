import { getOrgContext } from "@/lib/access";
import { guard } from "@/lib/guard";

interface Props {
  params: Promise<{ org: string }>;
  children: React.ReactNode;
}

/** Every page under /<org> requires membership; non-members get the 404 page. Pages pick their own frame. */
export default async function OrgLayout({ params, children }: Props) {
  await guard(getOrgContext((await params).org));
  return children;
}
