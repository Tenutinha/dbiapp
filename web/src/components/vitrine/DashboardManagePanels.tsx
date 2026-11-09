"use client";

import { useState, useTransition } from "react";
import { removeTemplateAction, type CatalogActionResult } from "@/app/plataforma/catalogo/actions";

function Feedback({ result }: { result: CatalogActionResult | null }) {
  if (!result) return null;
  return <p role="status" className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>;
}

interface DeletePanelProps {
  id: string;
  name: string;
  usage: number;
  builtIn: boolean;
  onDeleted: () => void;
}

/** "Exclusão" tab: only unused, non-built-in dashboards can go; the others are told to archive instead. */
export function DeletePanel({ id, name, usage, builtIn, onDeleted }: DeletePanelProps) {
  const [pending, start] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<CatalogActionResult | null>(null);
  const blocked = builtIn
    ? "É um dashboard embutido (vem do código), por isso não pode ser excluído. Para tirá-lo do catálogo, arquive pelo ícone de status no cartão."
    : usage > 0
      ? `Está em uso em ${usage} ${usage === 1 ? "dashboard" : "dashboards"} de organizações, por isso não pode ser excluído. Para tirá-lo do catálogo sem afetar quem usa, arquive pelo ícone de status no cartão.`
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
      {blocked ? (
        <p className="rounded-lg border border-line bg-bg/60 p-3 text-sm text-muted">{blocked}</p>
      ) : (
        <>
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
