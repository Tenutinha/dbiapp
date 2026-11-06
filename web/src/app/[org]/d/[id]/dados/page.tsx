import type { Metadata } from "next";
import { Forbidden } from "@/components/AppShell";
import { instanceLinks } from "@/components/workspace/instanceLinks";
import { MainHeader, Workspace } from "@/components/workspace/Workspace";
import { loadSpace } from "@/lib/services/space";
import { PublishPanel } from "@/components/data/PublishPanel";
import { UploadCard, type UploadCardProps } from "@/components/data/UploadCard";
import { requireInstance } from "@/lib/access";
import { getDraft, listFiles, type DatasetFile } from "@/lib/data/repository";
import { formatBytes } from "@/lib/format";
import { guard } from "@/lib/guard";
import { requireTemplate } from "@/lib/services/datasets";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dados" };

function statusFor(table: string, draft: DatasetFile[], active: DatasetFile[]): UploadCardProps["status"] {
  const d = draft.find((f) => f.tableName === table);
  if (d) return { tone: "draft", label: `novo: ${d.rowCount.toLocaleString("pt-BR")} linhas · ${formatBytes(d.sizeBytes)}` };
  const a = active.find((f) => f.tableName === table);
  if (a) return { tone: "ok", label: `publicado: ${a.rowCount.toLocaleString("pt-BR")} linhas · ${formatBytes(a.sizeBytes)}` };
  return { tone: "missing", label: "aguardando arquivo" };
}

export default async function DataPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const access = await guard(requireInstance(id, "manageData", org));
  if (access === "forbidden") return <Forbidden message="Só a equipe de dados da organização gerencia os arquivos." />;

  const template = await requireTemplate(access.templateId);
  const draft = await getDraft(access.instanceId);
  const [draftFiles, activeFiles, space] = await Promise.all([
    draft ? listFiles(draft.id) : Promise.resolve([]),
    access.activeVersionId ? listFiles(access.activeVersionId) : Promise.resolve([]),
    loadSpace(access.org, access.client, access.membership),
  ]);
  const has = (t: string): boolean => [...draftFiles, ...activeFiles].some((f) => f.tableName === t);
  const pending = template.tables.filter((t) => !has(t.name)).map((t) => t.name);
  const canUpload = access.actions.has("manageData");

  return (
    <Workspace space={space} currentId={access.instanceId} userName={access.user.name}>
      <MainHeader
        kicker={access.client ? `${access.org.name} · ${access.client.name}` : access.org.name}
        meta="Dados"
        title={access.name}
        lead="Suba um arquivo por tabela. Validamos colunas, tipos e chaves contra o contrato e convertemos para Parquet."
        links={instanceLinks(access, "dados")}
      />

      <div className="mb-6">
        <PublishPanel
          orgSlug={access.org.slug}
          instanceId={access.instanceId}
          draftVersion={draft?.version ?? null}
          pendingTables={pending}
          canPublish={canUpload}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {template.tables.map((t) => (
          <UploadCard
            key={t.name}
            instanceId={access.instanceId}
            table={{ name: t.name, kind: t.kind, description: t.description, key: t.key, columns: t.columns }}
            status={statusFor(t.name, draftFiles, activeFiles)}
            canUpload={canUpload}
          />
        ))}
      </div>
    </Workspace>
  );
}
