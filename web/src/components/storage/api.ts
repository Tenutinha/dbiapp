/**
 * Browser side of the organization's file explorer: calls /api/orgs/<org>/storage and sends files
 * (straight to the bucket with a signed URL, or through the server on local storage).
 */
import type { BatchResult, ExplorerFolder, FolderUploadPlan } from "@/lib/services/org-storage";
import type { FileInsight, OrganizePlan, OrganizeResult } from "@/lib/services/file-analysis";
import type { ExplorerMeta } from "@/lib/storage-explorer";

export type { FileInsight, OrganizePlan, OrganizeResult } from "@/lib/services/file-analysis";

export type { BatchResult, ExplorerFolder } from "@/lib/services/org-storage";
export type { ExplorerItem } from "@/lib/storage-explorer";

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class ExplorerApiError extends Error {}

async function call<T>(org: string, body: object): Promise<T> {
  let res: Envelope<T>;
  try {
    const r = await fetch(`/api/orgs/${org}/storage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    res = (await r.json()) as Envelope<T>;
  } catch {
    throw new ExplorerApiError("Sem conexão com o servidor.");
  }
  if (!res.success || res.data === undefined) throw new ExplorerApiError(res.error ?? "Algo deu errado.");
  return res.data;
}

export const explorerApi = {
  list: (org: string, folder: string) => call<ExplorerFolder>(org, { action: "list", folder }),
  meta: (org: string) => call<ExplorerMeta>(org, { action: "meta" }),
  /** Layout and verdict of every file of a folder, by path. */
  analyze: (org: string, folder: string) => call<Record<string, FileInsight>>(org, { action: "analyze", folder }),
  organizePreview: (org: string, folder: string) => call<OrganizePlan>(org, { action: "organizePreview", folder }),
  organizeApply: (org: string, folder: string, paths: string[]) => call<OrganizeResult>(org, { action: "organizeApply", folder, paths }),
  mkdir: (org: string, folder: string, name: string) => call<{ path: string }>(org, { action: "mkdir", folder, name }),
  rename: (org: string, path: string, name: string) => call<{ path: string }>(org, { action: "rename", path, name }),
  move: (org: string, paths: string[], target: string) => call<BatchResult>(org, { action: "move", paths, target }),
  remove: (org: string, paths: string[]) => call<BatchResult>(org, { action: "remove", paths }),
};

/** One running transfer: resolves with the stored name or an error; `abort()` stops it. */
export interface Transfer {
  done: Promise<{ name?: string; error?: string }>;
  abort: () => void;
}

function send(method: "PUT" | "POST", url: string, body: Blob | FormData, headers: Record<string, string>, onProgress: (loaded: number) => void, xhr: XMLHttpRequest) {
  return new Promise<{ ok: boolean; text: string; aborted: boolean }>((resolve) => {
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, text: xhr.responseText, aborted: false });
    xhr.onerror = () => resolve({ ok: false, text: "", aborted: false });
    xhr.onabort = () => resolve({ ok: false, text: "", aborted: true });
    xhr.send(body);
  });
}

/** Stores one file in a folder of the organization's storage, reporting the bytes sent so far. */
export function uploadFile(org: string, folder: string, file: File, onProgress: (loaded: number) => void): Transfer {
  const xhr = new XMLHttpRequest();
  let cancelled = false;
  const done = (async () => {
    let plan: FolderUploadPlan;
    try {
      plan = await call<FolderUploadPlan>(org, { action: "uploadPlan", folder, file: file.name, size: file.size });
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Falha no envio." };
    }
    if (cancelled) return { error: "Cancelado." };
    if (plan.mode === "direct") {
      const form = new FormData();
      form.set("folder", folder);
      form.set("file", file);
      const res = await send("POST", `/api/orgs/${org}/storage/store`, form, {}, onProgress, xhr);
      if (res.aborted) return { error: "Cancelado." };
      try {
        const parsed = JSON.parse(res.text) as Envelope<{ name: string }>;
        return parsed.success ? { name: parsed.data?.name ?? plan.name } : { error: parsed.error ?? "Falha no envio." };
      } catch {
        return { error: "Falha no envio." };
      }
    }
    const res = await send("PUT", plan.signedUrl, file, { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, onProgress, xhr);
    if (res.aborted) return { error: "Cancelado." };
    return res.ok ? { name: plan.name } : { error: "O armazenamento recusou o envio (verifique a conexão ou o CORS do bucket)." };
  })();
  return {
    done,
    abort: () => {
      cancelled = true;
      xhr.abort();
    },
  };
}
