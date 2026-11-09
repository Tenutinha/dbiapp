/**
 * Sends one file from the computer to a folder of the organization's storage (the "Upload" step of the
 * data connector): asks the server for a plan, then PUTs straight to the bucket with a signed URL, or
 * posts the file to the server on local storage. Reports progress (0–1) while the bytes go.
 */
import type { Envelope } from "./types";

type StorePlan = { mode: "direct"; name: string } | { mode: "signed"; name: string; signedUrl: string };

export interface StoreResult {
  /** Name the file got in the folder (may differ from the original: safe characters, "-2" if taken). */
  name?: string;
  error?: string;
}

function send(method: "PUT" | "POST", url: string, body: Blob | FormData, headers: Record<string, string>, onProgress: (p: number) => void): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, text: xhr.responseText });
    xhr.onerror = () => resolve({ ok: false, text: "" });
    xhr.send(body);
  });
}

export async function storeFile(instanceId: string, folder: string, file: File, onProgress: (p: number) => void): Promise<StoreResult> {
  let plan: Envelope<StorePlan>;
  try {
    const res = await fetch(`/api/instances/${instanceId}/connector`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "uploadPlan", folder, file: file.name, size: file.size }),
    });
    plan = (await res.json()) as Envelope<StorePlan>;
  } catch {
    return { error: "Sem conexão com o servidor." };
  }
  if (!plan.success || !plan.data) return { error: plan.error ?? "Falha no envio." };

  if (plan.data.mode === "direct") {
    const body = new FormData();
    body.set("folder", folder);
    body.set("file", file);
    const res = await send("POST", `/api/instances/${instanceId}/connector/store`, body, {}, onProgress);
    try {
      const parsed = JSON.parse(res.text) as Envelope<{ name: string }>;
      return parsed.success ? { name: parsed.data?.name ?? plan.data.name } : { error: parsed.error ?? "Falha no envio." };
    } catch {
      return { error: "Falha no envio." };
    }
  }
  const put = await send("PUT", plan.data.signedUrl, file, { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, onProgress);
  return put.ok ? { name: plan.data.name } : { error: "Não foi possível enviar o arquivo para o armazenamento." };
}
