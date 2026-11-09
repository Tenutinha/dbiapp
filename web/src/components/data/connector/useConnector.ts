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

  return { folder, setFolder, data, loading, error, links, connect, disconnect, engage, upload };
}
