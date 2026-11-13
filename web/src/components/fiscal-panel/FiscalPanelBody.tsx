import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import type { ClientRef, OrgRef } from "@/lib/access";
import { loadFiscalPanel } from "@/lib/services/fiscal-panel";
import { CLIENTS_DIR } from "@/lib/storage-explorer";
import { FiscalPanel } from "./FiscalPanel";

interface FiscalPanelBodyProps {
  org: OrgRef;
  client: ClientRef | null;
  canManage: boolean;
}

/** The part of the panel that waits for the bucket's listings (inside a Suspense boundary). */
export async function FiscalPanelBody({ org, client, canManage }: FiscalPanelBodyProps) {
  const view = await loadFiscalPanel(org, client, canManage);
  return <FiscalPanel view={view} orgSlug={org.slug} filesFolder={client ? `${CLIENTS_DIR}/${client.slug}` : ""} />;
}

export function FiscalPanelFallback() {
  return <DashboardSkeleton />;
}
