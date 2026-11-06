import type { Metadata } from "next";
import { Forbidden } from "@/components/AppShell";
import { CopyButton } from "@/components/CopyButton";
import { instanceLinks } from "@/components/workspace/instanceLinks";
import { MainHeader, Workspace } from "@/components/workspace/Workspace";
import { loadSpace } from "@/lib/services/space";
import { createShareAction, revokeShareAction } from "@/app/actions";
import { requireInstance } from "@/lib/access";
import { listShareLinks, type ShareLink } from "@/lib/data/repository";
import { formatDateTime } from "@/lib/format";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compartilhar" };

function linkState(l: ShareLink): { label: string; active: boolean } {
  if (l.revokedAt) return { label: `revogado em ${formatDateTime(l.revokedAt)}`, active: false };
  if (l.expiresAt && new Date(l.expiresAt) < new Date()) return { label: "expirado", active: false };
  return { label: l.expiresAt ? `expira em ${formatDateTime(l.expiresAt)}` : "sem expiração", active: true };
}

export default async function SharePage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const access = await guard(requireInstance(id, "share", org));
  if (access === "forbidden") return <Forbidden message="Seu papel não permite compartilhar este dashboard." />;
  const [links, space] = await Promise.all([
    listShareLinks(access.instanceId),
    loadSpace(access.org, access.client, access.membership),
  ]);

  return (
    <Workspace space={space} currentId={access.instanceId} userName={access.user.name}>
      <MainHeader
        kicker={access.client ? `${access.org.name} · ${access.client.name}` : access.org.name}
        meta="Compartilhar"
        title={access.name}
        lead="Gere links somente leitura para convidados — sem precisar de conta na plataforma."
        links={instanceLinks(access, "compartilhar")}
      />

      <form action={createShareAction} className="card mb-6 flex flex-wrap items-end gap-3 p-5">
        <input type="hidden" name="instanceId" value={access.instanceId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">Validade do link</span>
          <select name="expiry" defaultValue="7" className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
            <option value="1">1 dia</option>
            <option value="7">7 dias</option>
            <option value="30">30 dias</option>
            <option value="never">Sem expiração</option>
          </select>
        </label>
        <button type="submit" className="btn btn-primary">Gerar link de convidado</button>
        <p className="w-full text-xs text-muted">
          Convidados veem sempre a versão publicada mais recente, com filtros, mas não acessam os arquivos nem a área de dados.
        </p>
      </form>

      <div className="card divide-y divide-line">
        {links.length === 0 && <p className="p-5 text-sm text-muted">Nenhum link gerado ainda.</p>}
        {links.map((l) => {
          const state = linkState(l);
          const path = `/s/${l.token}`;
          return (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <code className={`block truncate font-mono text-sm ${state.active ? "" : "text-muted line-through"}`}>{path}</code>
                <span className={`text-xs ${state.active ? "text-ok" : "text-muted"}`}>
                  {state.label} · criado em {formatDateTime(l.createdAt)}
                </span>
              </div>
              {state.active && (
                <div className="flex gap-2">
                  <CopyButton path={path} />
                  <form action={revokeShareAction}>
                    <input type="hidden" name="instanceId" value={access.instanceId} />
                    <input type="hidden" name="linkId" value={l.id} />
                    <button type="submit" className="btn btn-ghost px-3 py-1.5 text-xs text-danger">Revogar</button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Workspace>
  );
}
