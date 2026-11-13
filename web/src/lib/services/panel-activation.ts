/**
 * The panel of fiscal data is linked to a space like any catalog dashboard, but it has no table of its
 * own: an empty version is published at once, because the space only lists published dashboards.
 */
import "server-only";
import { getOrCreateDraft, promoteDraft } from "../data/repository";
import { isFiscalPanel } from "../fiscal/panel";

/** Publishes the empty version of a panel just linked (or linked by an older release). Idempotent. */
export async function activateFiscalPanel(instanceId: string): Promise<void> {
  const draft = await getOrCreateDraft(instanceId);
  const result = await promoteDraft(instanceId, draft.id, [], {}, { panel: "dados-fiscais" });
  // "draft_changed": another request published it at the same time.
  if (!result.ok && result.reason !== "draft_changed") throw new Error(`could not activate the fiscal panel ${instanceId}: ${result.reason}`);
}

/** After creating a dashboard from the catalog: a panel is made visible right away; any other dashboard waits for its data. */
export async function afterLink(templateId: string, instanceId: string): Promise<void> {
  if (isFiscalPanel(templateId)) await activateFiscalPanel(instanceId);
}
