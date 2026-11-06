"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { publishAction } from "@/app/actions";
import type { PublishResult } from "@/lib/services/datasets";

interface PublishPanelProps {
  orgSlug: string;
  instanceId: string;
  draftVersion: number | null;
  pendingTables: string[];
  canPublish: boolean;
}

export function PublishPanel({ orgSlug, instanceId, draftVersion, pendingTables, canPublish }: PublishPanelProps) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string; data?: PublishResult } | null>(null);

  const ready = draftVersion !== null && pendingTables.length === 0;

  return (
    <section className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        {draftVersion === null ? (
          <p className="text-muted">Nenhuma alteração pendente. Suba um arquivo para preparar uma nova versão.</p>
        ) : ready ? (
          <p>
            Versão <b>v{draftVersion}</b> pronta. Publicar troca os dados do dashboard de uma vez — sem quebrar quem está vendo.
          </p>
        ) : (
          <p className="text-muted">
            Versão v{draftVersion} em preparação. Falta: <span className="text-accent">{pendingTables.join(", ")}</span>
          </p>
        )}
        {result?.ok && (
          <p className="mt-2 text-ok">
            ✓ Publicado! <Link href={`/${orgSlug}/d/${instanceId}`} className="underline">Abrir dashboard →</Link>
          </p>
        )}
        {result && !result.ok && <p className="mt-2 text-danger">✕ {result.error}</p>}
        {result?.data?.orphans
          .filter((o) => o.orphans > 0)
          .map((o) => (
            <p key={o.relationship} className="mt-1 text-xs text-accent">
              ⚠ {o.orphans.toLocaleString("pt-BR")} linhas sem correspondência em {o.relationship} — aparecem como “(sem cadastro)”.
            </p>
          ))}
      </div>
      {canPublish && (
        <button
          className="btn btn-primary shrink-0"
          disabled={!ready || pending}
          onClick={() =>
            start(async () => {
              const res = await publishAction(instanceId);
              setResult({ ok: res.success, error: res.error, data: res.data });
            })
          }
        >
          {pending ? "Publicando…" : "Publicar dados"}
        </button>
      )}
    </section>
  );
}
