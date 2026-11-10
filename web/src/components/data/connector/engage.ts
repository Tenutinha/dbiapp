import type { TableReport } from "@/lib/ingest/ingest";
import type { Envelope, Link } from "./types";

/** One call to the connector's API. */
export type Post = <T>(body: object) => Promise<Envelope<T>>;

type PartReport = TableReport & { key?: string };

const REFUSED = "Arquivo recusado.";

/**
 * Engages a table's wire into the draft. One file goes in a single request, as always. Several files go
 * one request each (convert) and a last one that makes the table out of the converted files: no request ever handles
 * more than one raw file, so the number of files does not run into the server's time limit.
 *
 * `onStep` receives what is being done, to show while it runs. A refusal names the file it is about.
 */
export async function engageLink(link: Link, post: Post, onStep: (note: string) => void): Promise<Envelope<TableReport>> {
  const { table, files } = link;
  if (files.length === 1) {
    return post<TableReport>({ action: "engage", folder: files[0].folder, file: files[0].file, table });
  }

  const parts: { key: string; file: string }[] = [];
  const warnings = new Set<string>();
  for (const [i, f] of files.entries()) {
    onStep(`Convertendo ${i + 1} de ${files.length}: ${f.file}`);
    const res = await post<PartReport>({ action: "part", folder: f.folder, file: f.file, table });
    const key = res.success ? res.data?.key : undefined;
    if (!key) {
      // The copies already converted would stay behind for nothing.
      if (parts.length > 0) await post({ action: "discard", table, keys: parts.map((p) => p.key) });
      return { success: false, data: res.data, error: `${f.file}: ${res.error ?? res.data?.errors[0] ?? REFUSED}` };
    }
    parts.push({ key, file: f.file });
    for (const w of res.data?.warnings ?? []) warnings.add(w);
  }

  onStep(`Juntando ${files.length} arquivos`);
  const joined = await post<TableReport>({ action: "join", table, parts });
  // What each conversion warned about (ignored columns…) is still true of the table.
  return joined.data ? { ...joined, data: { ...joined.data, warnings: [...new Set([...warnings, ...joined.data.warnings])] } } : joined;
}
