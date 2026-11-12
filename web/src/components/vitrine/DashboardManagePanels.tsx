"use client";

import { useState, useTransition } from "react";
import { removeTemplateAction, type CatalogActionResult } from "@/app/plataforma/catalogo/actions";
import { placeOf, type TemplateUseView } from "@/lib/catalog-uses";

function Feedback({ result }: { result: CatalogActionResult | null }) {
  if (!result) return null;
  return <p role="status" className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>;
}

interface DeletePanelProps {
  id: string;
  name: string;
  usage: number;
  /** Every dashboard made from it (archived ones go with the deletion). */
  uses: TemplateUseView[];
  builtIn: boolean;
  onDeleted: () => void;
}

/** "Exclusão" tab: only unused, non-built-in dashboards can go; the others are told to archive instead. */
export function DeletePanel({ id, name, usage, uses, builtIn, onDeleted }: DeletePanelProps) {
  const active = uses.filter((u) => !u.archived);
  const archived = uses.filter((u) => u.archived);
  const [pending, start] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<CatalogActionResult | null>(null);
  const blocked = builtIn
    ? "É um dashboard embutido (vem do código), por isso não pode ser excluído. Para tirá-lo do catálogo, arquive pelo ícone de status no cartão."
    : usage > 0
      ? `Está em uso em ${usage} ${usage === 1 ? "dashboard" : "dashboards"}, por isso não pode ser excluído. Remova o dashboard do cliente na administração da organização, ou arquive este pelo ícone de status no cartão (quem usa não é afetado).`
      : null;

  const remove = (): void => {
    start(async () => {
      const res = await removeTemplateAction(id);
      setResult(res);
      if (res.ok) onDeleted();
    });
  };

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-semibold">Excluir dashboard</h2>
        <p className="mt-0.5 text-xs text-muted">Apaga “{name}” do catálogo de vez. Não dá para desfazer.</p>
      </div>
      {uses.length > 0 && (
        <div className="text-sm">
          <p className="text-xs font-semibold text-muted">Onde está</p>
          <ul className="mt-1 flex flex-col gap-1">
            {[...active, ...archived].map((u, i) => (
              <li key={`${placeOf(u)}-${u.dashboard}-${i}`} className="flex items-baseline justify-between gap-3 rounded-md border border-line px-3 py-1.5">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{placeOf(u)}</span>
                  <span className="text-muted"> · {u.dashboard}</span>
                </span>
                <span className={`shrink-0 text-xs ${u.archived ? "text-muted" : "text-ok"}`}>{u.archived ? "arquivado" : "em uso"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {blocked ? (
        <p className="rounded-lg border border-line bg-bg/60 p-3 text-sm text-muted">{blocked}</p>
      ) : (
        <>
          {archived.length > 0 && (
            <p className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
              {archived.length === 1 ? "O dashboard arquivado acima será apagado junto" : `Os ${archived.length} dashboards arquivados acima serão apagados junto`}, com os
              dados que tinham.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Entendo que a exclusão é definitiva.
          </label>
          <button type="button" onClick={remove} disabled={!confirmed || pending} className="btn w-fit bg-danger text-white disabled:opacity-50">
            {pending ? "Excluindo…" : "Excluir dashboard"}
          </button>
        </>
      )}
      <Feedback result={result} />
    </div>
  );
}
