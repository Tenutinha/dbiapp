import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden, OrgFrame, PageHeader } from "@/components/AppShell";
import { DataManager } from "@/components/data/DataManager";
import { requireInstance } from "@/lib/access";
import { guard } from "@/lib/guard";
import { allowedActions } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dados" };

/**
 * Data of one dashboard (upload, validate, publish) as a full page. Admins usually reach the same
 * manager as a modal from /<org>/admin (column "Dados"); this page stays for direct links.
 */
export default async function DataPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const access = await guard(requireInstance(id, "manageData", org));
  if (access === "forbidden") return <Forbidden message="Só a equipe de dados da organização gerencia os arquivos." />;
  const isOrgAdmin = allowedActions(access.membership, { clientId: null }).has("admin");

  return (
    <OrgFrame org={access.org} isAdmin={isOrgAdmin} userName={access.user.name}>
      <PageHeader
        crumbs={[
          { label: access.org.name, href: `/${org}` },
          ...(isOrgAdmin ? [{ label: "Administração", href: `/${org}/admin` }] : []),
        ]}
        eyebrow={access.client ? `Dados · ${access.client.name}` : "Dados"}
        title={access.name}
        subtitle="Suba um arquivo por tabela. Validamos colunas, tipos e chaves contra o contrato e convertemos para Parquet."
        actions={
          access.activeVersionId ? (
            <Link href={`/${org}/d/${access.instanceId}`} className="btn btn-ghost">Ver dashboard</Link>
          ) : undefined
        }
      />
      <DataManager access={access} />
    </OrgFrame>
  );
}
