import type { TableReport } from "@/lib/ingest/ingest";

export interface UploadResponse {
  success: boolean;
  data?: TableReport;
  error?: string;
}

type UploadPlan = { mode: "direct" } | { mode: "signed"; key: string; signedUrl: string };

/**
 * Sends one file for one table of a dashboard. Asks the server how: straight in the request (local
 * storage), or to a pre-signed Storage URL followed by an "ingest" call (production — avoids body
 * size limits). Used by the upload cards and by the data connector's plug.
 */
export async function sendFile(instanceId: string, table: string, file: File, onStep: (step: string) => void): Promise<UploadResponse> {
  const base = `/api/instances/${instanceId}/upload`;
  const planRes = await fetch(`${base}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, fileName: file.name, size: file.size }),
  });
  const plan = (await planRes.json()) as { success: boolean; data?: UploadPlan; error?: string };
  if (!plan.success || !plan.data) return { success: false, error: plan.error ?? "Falha no envio." };

  if (plan.data.mode === "direct") {
    onStep("Validando");
    const body = new FormData();
    body.set("table", table);
    body.set("file", file);
    return (await fetch(base, { method: "POST", body })).json() as Promise<UploadResponse>;
  }

  const put = await fetch(plan.data.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file,
  });
  if (!put.ok) return { success: false, error: "Não foi possível enviar o arquivo para o armazenamento." };

  onStep("Validando");
  const ingest = await fetch(`${base}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, key: plan.data.key, fileName: file.name }),
  });
  return ingest.json() as Promise<UploadResponse>;
}
