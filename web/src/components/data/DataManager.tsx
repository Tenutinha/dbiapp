import type { InstanceAccess } from "@/lib/access";
import { getDraft, listFiles, type DatasetFile } from "@/lib/data/repository";
import { formatBytes } from "@/lib/format";
import { requireTemplate } from "@/lib/services/datasets";
import { fiscalImporter, listFiscalPeriods, type FiscalPeriod } from "@/lib/services/fiscal";
import { storageFolderSuggestions } from "@/lib/services/storage-import";
import { DataConnector } from "./connector/DataConnector";
import type { ConnectorTable } from "./connector/types";
import { FiscalImporter } from "./FiscalImporter";
import { PublishPanel } from "./PublishPanel";

/** Stored raw files of a fiscal dashboard; a storage hiccup must not take the data page down. */
async function fiscalPeriods(access: InstanceAccess): Promise<FiscalPeriod[]> {
  try {
    return await listFiscalPeriods(access);
  } catch (err) {
    console.error("[data] could not list fiscal files", err);
    return [];
  }
}

function statusFor(table: string, draft: DatasetFile[], active: DatasetFile[]): ConnectorTable["status"] {
  const d = draft.find((f) => f.tableName === table);
  if (d) return { tone: "draft", label: `novo: ${d.rowCount.toLocaleString("pt-BR")} linhas · ${formatBytes(d.sizeBytes)}` };
  const a = active.find((f) => f.tableName === table);
  if (a) return { tone: "ok", label: `publicado: ${a.rowCount.toLocaleString("pt-BR")} linhas · ${formatBytes(a.sizeBytes)}` };
  return { tone: "missing", label: "aguardando arquivo" };
}

/**
 * Everything to manage one dashboard's data: publish the draft and the "engate" map (wire files of the
 * storage folder to the contract tables, or upload through each table's plug). Shared by the data page (/<org>/d/<id>/dados) and the admin's data modal.
 * Uploads and imports call router.refresh(), so whichever page hosts it re-renders with the new status.
 */
export async function DataManager({ access }: { access: InstanceAccess }) {
  const template = await requireTemplate(access.templateId);
  const draft = await getDraft(access.instanceId);
  const [draftFiles, activeFiles, suggestions] = await Promise.all([
    draft ? listFiles(draft.id) : Promise.resolve([]),
    access.activeVersionId ? listFiles(access.activeVersionId) : Promise.resolve([]),
    access.actions.has("manageData") ? storageFolderSuggestions(access.org.slug) : Promise.resolve([]),
  ]);
  const has = (t: string): boolean => [...draftFiles, ...activeFiles].some((f) => f.tableName === t);
  const pending = template.tables.filter((t) => !has(t.name)).map((t) => t.name);
  const canUpload = access.actions.has("manageData");
  const fiscal = fiscalImporter(access);
  const periods = fiscal && canUpload ? await fiscalPeriods(access) : [];
  // Prepared folder named after the dashboard (eleicoes-presidente → preparado/presidente), else the first one.
  const words = template.id.split("-");
  const startFolder = suggestions.find((f) => words.some((w) => f.split("/").pop() === w)) ?? suggestions[0] ?? "";

  return (
    <div className="flex flex-col gap-6">
      <PublishPanel
        orgSlug={access.org.slug}
        instanceId={access.instanceId}
        draftVersion={draft?.version ?? null}
        pendingTables={pending}
        canPublish={canUpload}
      />

      {fiscal && (
        <FiscalImporter
          instanceId={access.instanceId}
          title={fiscal.title}
          extensions={fiscal.extensions}
          initialPeriods={periods}
          canUpload={canUpload}
        />
      )}

      <DataConnector
        instanceId={access.instanceId}
        initialFolder={startFolder}
        canUpload={canUpload}
        tables={template.tables.map((t) => ({
          name: t.name,
          kind: t.kind,
          description: t.description,
          columns: t.columns.map((c) => ({ name: c.name, type: c.type, required: c.required })),
          status: statusFor(t.name, draftFiles, activeFiles),
        }))}
      />
    </div>
  );
}
