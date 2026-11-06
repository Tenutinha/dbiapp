import Link from "next/link";
import { activateTemplate } from "@/app/actions";
import { Notice } from "@/components/AppShell";
import type { VitrineViewer } from "@/lib/vitrine-server";

interface AddToOrgProps {
  templateId: string;
  viewer: VitrineViewer | null;
}

/** "Add to my organization": sign-in prompt, org picker, or why it is not possible. */
export function AddToOrg({ templateId, viewer }: AddToOrgProps) {
  if (!viewer) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">Entre na sua conta para adicionar este dashboard à sua organização.</p>
        <Link href="/entrar" className="btn btn-primary w-full">Entrar para adicionar</Link>
        <Link href="/entrar/cadastro" className="btn btn-ghost w-full">Criar conta grátis</Link>
      </div>
    );
  }

  if (viewer.orgs.length === 0) {
    return (
      <Notice>
        Só admins e editores de dados de uma organização podem adicionar dashboards. Peça acesso ao admin da sua organização.
      </Notice>
    );
  }

  const [only] = viewer.orgs;
  return (
    <form action={activateTemplate} className="flex flex-col gap-2">
      <input type="hidden" name="templateId" value={templateId} />
      {viewer.orgs.length === 1 ? (
        <>
          <input type="hidden" name="org" value={only.slug} />
          <p className="text-sm text-muted">
            Será adicionado em <strong className="text-text">{only.name}</strong>.
          </p>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Organização</span>
          <select name="org" required defaultValue="" className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
            <option value="" disabled>Escolha a organização</option>
            {viewer.orgs.map((o) => (
              <option key={o.id} value={o.slug}>{o.name}</option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className="btn btn-primary w-full">Adicionar à organização</button>
      <p className="text-xs text-muted">Depois de adicionar, você sobe os arquivos (CSV ou Parquet) e publica.</p>
    </form>
  );
}
