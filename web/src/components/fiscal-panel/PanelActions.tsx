"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { publishAction } from "@/app/actions";
import type { PanelFile } from "@/lib/services/fiscal-panel";
import { useFileReader } from "./FileReader";
import { count } from "./labels";

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface BuildView {
  ok: boolean;
  files: number;
  skipped: { path: string; error: string }[];
  tables: { table: string; ok: boolean; rowCount: number; errors: string[] }[];
}

interface PanelActionsProps {
  dashboardId: string;
  mode: "sped" | "documents";
  /** Files to read, in order (missing, then failed). */
  toRead: PanelFile[];
  /** Loose files that "Organizar" may file (the model's folder root plus the space's). */
  loose: number;
  hasDraft: boolean;
}

async function post<T>(url: string, body?: unknown): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    return (await res.json()) as Envelope<T>;
  } catch {
    return { success: false, error: "Sem conexão com o servidor." };
  }
}

/**
 * What who manages the data does from the panel, step by step: file the loose files, read the files one
 * request at a time ("37 de 103"; a closed page resumes from the markers), put the tables together in the
 * draft, and publish.
 */
export function PanelActions({ dashboardId, mode, toRead, loose, hasDraft }: PanelActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "organizar" | "montar" | "publicar">(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [build, setBuild] = useState<BuildView | null>(null);
  const reader = useFileReader();

  const organize = async (): Promise<void> => {
    setBusy("organizar");
    setMessage(null);
    const res = await post<{ adopted: number }>(`/api/instances/${dashboardId}/fiscal/organizar`);
    setBusy(null);
    setMessage(res.success
      ? { ok: true, text: `${count(res.data?.adopted ?? 0)} arquivo(s) organizado(s) por empresa e mês.` }
      : { ok: false, text: res.error ?? "Não foi possível organizar." });
    router.refresh();
  };

  const readAll = async (): Promise<void> => {
    setMessage(null);
    setBuild(null);
    await reader.read(toRead);
  };

  const assemble = async (): Promise<void> => {
    setBusy("montar");
    setMessage(null);
    setBuild(null);
    const res = await post<BuildView>(`/api/instances/${dashboardId}/fiscal/montar`);
    setBusy(null);
    if (res.data) setBuild(res.data);
    setMessage(res.success
      ? { ok: true, text: `Tabelas montadas no rascunho com ${count(res.data?.files ?? 0)} arquivo(s). Confira e publique.` }
      : { ok: false, text: res.error ?? "Não foi possível montar as tabelas." });
    router.refresh();
  };

  const publish = async (): Promise<void> => {
    if (!window.confirm("Publicar as tabelas do rascunho? O dashboard passa a mostrar estes dados para quem tem acesso.")) return;
    setBusy("publicar");
    setMessage(null);
    const res = await publishAction(dashboardId);
    setBusy(null);
    setMessage(res.success ? { ok: true, text: "Publicado." } : { ok: false, text: res.error ?? "Não foi possível publicar." });
    router.refresh();
  };

  const idle = busy === null && !reader.reading;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-bg-2/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {loose > 0 && (
          <button type="button" className="btn btn-ghost" disabled={!idle} onClick={() => void organize()}>
            {busy === "organizar" ? "Organizando…" : `Organizar soltos (${count(loose)})`}
          </button>
        )}
        {mode === "sped" && toRead.length > 0 && (
          <button type="button" className="btn btn-primary" disabled={!idle} onClick={() => void readAll()}>
            {reader.reading ? "Lendo…" : `Ler ${count(toRead.length)} arquivo(s)`}
          </button>
        )}
        <button type="button" className={toRead.length === 0 || mode === "documents" ? "btn btn-primary" : "btn btn-ghost"} disabled={!idle} onClick={() => void assemble()}>
          {busy === "montar" ? "Montando…" : "Montar tabelas"}
        </button>
        {hasDraft && (
          <button type="button" className="btn btn-ghost" disabled={!idle} onClick={() => void publish()}>
            {busy === "publicar" ? "Publicando…" : "Publicar"}
          </button>
        )}
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`} aria-live="polite">{message.ok ? "✓" : "✕"} {message.text}</p>}
      {build && (
        <div className="flex flex-col gap-0.5 text-xs">
          {build.tables.map((t) => (
            <p key={t.table} className={t.ok ? "text-muted" : "text-danger"}>
              {t.table}: {t.ok ? `${count(t.rowCount)} linhas` : t.errors.join(" ")}
            </p>
          ))}
          {build.skipped.map((s) => <p key={s.path} className="text-accent">⚠ {s.path}: {s.error}</p>)}
        </div>
      )}
      <p className="text-xs text-muted">
        {mode === "sped"
          ? "Cada arquivo é lido numa requisição; se a página fechar, o que já foi lido fica guardado. Para ler só um mês, clique no quadradinho dele no mapa. Montar junta o que foi lido nas tabelas do rascunho; publicar mostra no dashboard."
          : "A NF-e é lida inteira a cada montagem. Montar põe as tabelas no rascunho; publicar mostra no dashboard."}
      </p>
    </div>
  );
}
