import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import type { ClientRef, OrgRef } from "@/lib/access";
import { loadFiscalPanel } from "@/lib/services/fiscal-panel";
import { defaultLocalFolder, localLoadAvailable } from "@/lib/services/local-load";
import { CLIENTS_DIR } from "@/lib/storage-explorer";
import { FiscalPanel } from "./FiscalPanel";

interface FiscalPanelBodyProps {
  org: OrgRef;
  client: ClientRef | null;
  canManage: boolean;
  /** The platform's administrator converts files on the machine the server runs on (local server only). */
  platformAdmin: boolean;
}

/** The part of the panel that waits for the bucket's listings (inside a Suspense boundary). */
export async function FiscalPanelBody({ org, client, canManage, platformAdmin }: FiscalPanelBodyProps) {
  const view = await loadFiscalPanel(org, client, canManage);
  const localFolder = canManage && platformAdmin && localLoadAvailable() ? defaultLocalFolder() : null;
  return <FiscalPanel view={view} orgSlug={org.slug} filesFolder={client ? `${CLIENTS_DIR}/${client.slug}` : ""} localFolder={localFolder} />;
}

export function FiscalPanelFallback() {
  return <DashboardSkeleton />;
}
