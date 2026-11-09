"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { TableReport } from "@/lib/ingest/ingest";
import type { SchemaCheck } from "@/lib/ingest/schema-check";
import { sendFile } from "../upload-client";
import type { ConnectorFile, Envelope, Link } from "./types";

interface FolderData {
  folder: string;
  files: ConnectorFile[];
  folders: string[];
  suggestions: { table: string; file: string }[];
}

async function post<T>(instanceId: string, body: object): Promise<Envelope<T>> {
  try {
    const res = await fetch(`/api/instances/${instanceId}/connector`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Envelope<T>;
  } catch {
    return { success: false, error: "Sem conexão com o servidor. Tente de novo." };
  }
}

/** Replaces the link of one table (immutably). */
function put(links: Link[], link: Link): Link[] {
  return [...links.filter((l) => l.table !== link.table), link];
}

/** State and server calls of the data connector: folder listing, wires, checks, engage and plug uploads. */
export function useConnector(instanceId: string, initialFolder: string) {
  const router = useRouter();
  const [folder, setFolder] = useState(initialFolder);
  const [data, setData] = useState<FolderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  /** Bumped to list the folder again (after storing files in it). */
  const [version, setVersion] = useState(0);
  const [storing, setStoring] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void post<FolderData>(instanceId, { action: "list", folder }).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (!res.success || !res.data) {
        setData(null);
        setError(res.error ?? "Não foi possível ler a pasta.");
        return;
      }
      setData(res.data);
      // Name-based suggestions show as dashed wires; engaged/uploaded wires of other folders stay.
      setLinks((prev) => [
        ...prev.filter((l) => l.phase === "engaged" || l.uploaded),
        ...res.data!.suggestions
          .filter((s) => !prev.some((l) => l.table === s.table && (l.phase === "engaged" || l.uploaded)))
          .map((s): Link => ({ table: s.table, file: s.file, phase: "suggested" })),
      ]);
    });
    return () => {
      alive = false;
    };
  }, [instanceId, folder, version]);

  /**
   * Stores files from the computer in the open folder of the bucket (kept as they are; engaging is a
   * separate step). Returns the failures, by file name.
   */
  const store = useCallback(async (files: File[]): Promise<{ name: string; error: string }[]> => {
    const failures: { name: string; error: string }[] = [];
    for (const [i, file] of files.entries()) {
      setStoring(`Enviando ${i + 1} de ${files.length}…`);
      const error = await storeOne(instanceId, folder, file).catch(() => "Falha de rede.");
      if (error) failures.push({ name: file.name, error });
    }
    setStoring(null);
    setVersion((v) => v + 1);
    return failures;
  }, [instanceId, folder]);

  /** Wires a storage file to a table and checks its columns right away. */
  const connect = useCallback(async (file: string, table: string) => {
    setLinks((prev) => put(prev, { table, file, phase: "checking" }));
    const res = await post<SchemaCheck>(instanceId, { action: "check", folder, file, table });
    setLinks((prev) => {
      if (!prev.some((l) => l.table === table && l.file === file)) return prev; // disconnected meanwhile
      if (!res.success || !res.data) return put(prev, { table, file, phase: "failed", note: res.error ?? "Não foi possível ler o arquivo." });
      return put(prev, { table, file, phase: res.data.ok ? "ok" : "diverge", check: res.data });
    });
  }, [instanceId, folder]);

  const disconnect = useCallback((table: string) => {
    setLinks((prev) => prev.filter((l) => l.table !== table));
  }, []);

  const finish = useCallback((link: Link, res: Envelope<TableReport>) => {
    const ok = res.success && res.data?.ok;
    setLinks((prev) => put(prev, {
      ...link,
      phase: ok ? "engaged" : "failed",
      report: res.data,
      note: ok ? undefined : res.error ?? res.data?.errors[0] ?? "Arquivo recusado.",
    }));
    if (ok) router.refresh();
  }, [router]);

  /** Converts the wired file into the dashboard's draft (same validation as an upload). */
  const engage = useCallback(async (link: Link) => {
    setLinks((prev) => put(prev, { ...link, phase: "engaging", note: undefined }));
    finish(link, await post<TableReport>(instanceId, { action: "engage", folder, file: link.file, table: link.table }));
  }, [instanceId, folder, finish]);

  /** The table's plug: a file from the computer goes straight in. */
  const upload = useCallback(async (table: string, file: File) => {
    const link: Link = { table, file: file.name, uploaded: true, phase: "engaging", note: "Enviando" };
    setLinks((prev) => put(prev, link));
    let res: Envelope<TableReport>;
    try {
      res = await sendFile(instanceId, table, file, (step) => setLinks((prev) => put(prev, { ...link, note: step })));
    } catch {
      res = { success: false, error: "Não foi possível enviar o arquivo. Verifique a conexão." };
    }
    finish(link, res);
  }, [instanceId, finish]);

  return { folder, setFolder, data, loading, error, links, connect, disconnect, engage, upload, store, storing };
}

type StorePlan = { mode: "direct"; name: string } | { mode: "signed"; name: string; signedUrl: string };

/** One file to the folder: a signed URL straight to the bucket, or the request body on local storage. */
async function storeOne(instanceId: string, folder: string, file: File): Promise<string | null> {
  const plan = await post<StorePlan>(instanceId, { action: "uploadPlan", folder, file: file.name, size: file.size });
  if (!plan.success || !plan.data) return plan.error ?? "Falha no envio.";
  if (plan.data.mode === "direct") {
    const body = new FormData();
    body.set("folder", folder);
    body.set("file", file);
    const res = (await (await fetch(`/api/instances/${instanceId}/connector/store`, { method: "POST", body })).json()) as Envelope<unknown>;
    return res.success ? null : (res.error ?? "Falha no envio.");
  }
  const put = await fetch(plan.data.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file,
  });
  return put.ok ? null : "Não foi possível enviar o arquivo para o armazenamento.";
}
