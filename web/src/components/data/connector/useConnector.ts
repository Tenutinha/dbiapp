"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { SchemaCheck } from "@/lib/ingest/schema-check";
import { engageLink } from "./engage";
import { addFiles, putLink, removeFile, setFileCheck, withSuggestions } from "./links";
import type { ConnectorFile, Envelope, FilePick, Link } from "./types";

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

/**
 * State and server calls of the data connector: name-based suggestions from the space's folder, wires
 * (one or more files per table, each with its own folder, chosen in the file explorer), checks and engage.
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

  /** Adds storage files to a table's wire and checks the columns of each one right away. */
  const connect = useCallback((table: string, picks: readonly FilePick[]) => {
    setLinks((prev) => addFiles(prev, table, picks));
    for (const pick of picks) {
      void post<SchemaCheck>(instanceId, { action: "check", folder: pick.folder, file: pick.file, table }).then((res) => {
        setLinks((prev) => setFileCheck(prev, table, pick, res.success && res.data
          ? { state: res.data.ok ? "ok" : "diverge", check: res.data }
          : { state: "failed", note: res.error ?? "Não foi possível ler o arquivo." }));
      });
    }
  }, [instanceId]);

  /** Takes one file off a table's wire. */
  const remove = useCallback((table: string, pick: FilePick) => {
    setLinks((prev) => removeFile(prev, table, pick));
  }, []);

  const disconnect = useCallback((table: string) => {
    setLinks((prev) => prev.filter((l) => l.table !== table));
  }, []);

  /** Converts the wired file(s) into the dashboard's draft (same validation as an upload). */
  const engage = useCallback(async (link: Link) => {
    const engaging = (note?: string): void => setLinks((prev) => putLink(prev, { ...link, phase: "engaging", report: undefined, note }));
    engaging();
    const res = await engageLink(link, (body) => post(instanceId, body), engaging);
    const ok = res.success && res.data?.ok;
    setLinks((prev) => putLink(prev, {
      ...link,
      phase: ok ? "engaged" : "failed",
      report: res.data,
      note: ok ? undefined : res.error ?? res.data?.errors[0] ?? "Arquivo recusado.",
    }));
    if (ok) router.refresh();
  }, [instanceId, router]);

  return { folder, data, loading, error, links, connect, remove, disconnect, engage, reload };
}
