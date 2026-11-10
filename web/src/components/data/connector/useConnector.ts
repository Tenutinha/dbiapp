"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { TableReport } from "@/lib/ingest/ingest";
import type { SchemaCheck } from "@/lib/ingest/schema-check";
import { putLink, withSuggestions } from "./links";
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

const put = putLink;

/**
 * State and server calls of the data connector: name-based suggestions from the space's folder, wires
 * (each file with its own folder, chosen in the file explorer), checks, engage and plug uploads.
 */
export function useConnector(instanceId: string, folder: string) {
  const router = useRouter();
  const [data, setData] = useState<FolderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  /** Bumped to list the folder again (after storing files in it). */
  const [version, setVersion] = useState(0);

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
      // Name-based suggestions show as dashed wires; the wires the person made stay (see withSuggestions).
      const { suggestions } = res.data;
      setLinks((prev) => withSuggestions(prev, suggestions, folder));
    });
    return () => {
      alive = false;
    };
  }, [instanceId, folder, version]);

  /** Lists the space's folder again (fresh suggestions after files were added). */
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  /** Wires a storage file to a table and checks its columns right away. */
  const connect = useCallback(async (from: string, file: string, table: string) => {
    setLinks((prev) => put(prev, { table, folder: from, file, phase: "checking" }));
    const res = await post<SchemaCheck>(instanceId, { action: "check", folder: from, file, table });
    setLinks((prev) => {
      if (!prev.some((l) => l.table === table && l.file === file && l.folder === from)) return prev; // disconnected meanwhile
      if (!res.success || !res.data) return put(prev, { table, folder: from, file, phase: "failed", note: res.error ?? "Não foi possível ler o arquivo." });
      return put(prev, { table, folder: from, file, phase: res.data.ok ? "ok" : "diverge", check: res.data });
    });
  }, [instanceId]);

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
    finish(link, await post<TableReport>(instanceId, { action: "engage", folder: link.folder ?? folder, file: link.file, table: link.table }));
  }, [instanceId, folder, finish]);

  return { folder, data, loading, error, links, connect, disconnect, engage, reload };
}
