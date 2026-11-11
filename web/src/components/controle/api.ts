import type { ReceiptMime } from "@/lib/controle/receipts";

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Thrown with a message that can be shown to the person as it is. */
export class ControleError extends Error {}

const OFFLINE = "Sem conexão. Confira a internet e tente de novo.";

async function unwrap<T>(request: Promise<Response>): Promise<T> {
  let res: Response;
  try {
    res = await request;
  } catch {
    throw new ControleError(OFFLINE);
  }
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!body?.success) throw new ControleError(body?.error ?? "Não foi possível concluir. Tente de novo.");
  return body.data as T;
}

/** "/api/controle/<org>/<client>" */
export function controleApi(orgSlug: string, clientSlug: string): string {
  return `/api/controle/${orgSlug}/${clientSlug}`;
}

/** One action of the module's endpoint (see app/api/controle/[org]/[client]/route.ts). */
export function call<T>(base: string, body: Record<string, unknown>): Promise<T> {
  return unwrap<T>(fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

export interface SentReceipt {
  path: string;
  mime: ReceiptMime;
}

type Plan = { mode: "direct" } | ({ mode: "signed"; signedUrl: string } & SentReceipt);

/**
 * Stores a receipt in the client's folder. The server says how: straight to the bucket through a
 * pre-signed URL (production — no request size limit), or in the request body (local disk).
 */
export async function sendReceipt(base: string, file: File): Promise<SentReceipt> {
  const plan = await call<Plan>(base, { action: "receiptPlan", mime: file.type, size: file.size });
  if (plan.mode === "direct") {
    const body = new FormData();
    body.set("file", file);
    return unwrap<SentReceipt>(fetch(`${base}/comprovante/enviar`, { method: "POST", body }));
  }
  const put = await fetch(plan.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file,
  }).catch(() => null);
  if (!put?.ok) throw new ControleError("Não foi possível enviar o comprovante. Tente de novo.");
  return { path: plan.path, mime: plan.mime };
}
