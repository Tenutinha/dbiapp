import Link from "next/link";
import { redirect } from "next/navigation";
import type { ClientRef, OrgRef } from "@/lib/access";
import type { CurrentUser } from "@/lib/auth";
import { firstItem } from "@/lib/layout/toc";
import type { Membership } from "@/lib/permissions";
import { loadSpace } from "@/lib/services/space";
import { MainHeader, Workspace } from "./Workspace";

interface SpaceHomeProps {
  org: OrgRef;
  client: ClientRef | null;
  membership: Membership;
  user: CurrentUser;
}

/** Opening a space lands on its first published dashboard; empty spaces show a quiet cover. */
export async function SpaceHome({ org, client, membership, user }: SpaceHomeProps) {
  const space = await loadSpace(org, client, membership);
  const first = firstItem(space.toc);
  if (first) redirect(`/${org.slug}/d/${first.id}`);

  const canManage = space.actions.has("manageData");
  const catalogHref = `/${org.slug}/catalogo${client ? `?para=${client.slug}` : ""}`;

  return (
    <Workspace space={space} currentId={null} userName={user.name}>
      <MainHeader
        kicker={client ? `${org.name} · ${client.name}` : org.name}
        title={client?.name ?? org.name}
        lead={
          canManage
            ? "Nenhum dashboard publicado ainda. Adicione um do catálogo, suba os dados e ele aparece aqui."
            : "Nenhum dashboard publicado ainda. Assim que a equipe publicar, ele aparece aqui."
        }
      />
      {canManage && (
        <Link href={catalogHref} className="btn btn-primary">Adicionar dashboard</Link>
      )}
    </Workspace>
  );
}
