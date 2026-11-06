import type { InstanceAccess } from "@/lib/access";

export type InstanceTab = "dashboard" | "dados" | "compartilhar";

/** Quiet text links under a dashboard title; hidden entirely when the user can only view. */
export function instanceLinks(access: InstanceAccess, active: InstanceTab): { href: string; label: string; active: boolean }[] {
  const base = `/${access.org.slug}/d/${access.instanceId}`;
  const published = access.activeVersionId !== null;
  const links = [
    { tab: "dashboard" as const, href: base, label: "Dashboard", show: published },
    { tab: "dados" as const, href: `${base}/dados`, label: "Dados", show: access.actions.has("manageData") },
    { tab: "compartilhar" as const, href: `${base}/compartilhar`, label: "Compartilhar", show: published && access.actions.has("share") },
  ].filter((l) => l.show);
  return links.length > 1 ? links.map((l) => ({ href: l.href, label: l.label, active: l.tab === active })) : [];
}
