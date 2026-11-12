/**
 * The "controle" module: a client's own people record purchases (with the proof kept and read by AI)
 * and sales. It exists only in organizations that have the module on; elsewhere every entry point
 * answers 404, like any other thing the person may not see.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { getClientContext, requireAction, type ClientContext } from "../access";
import { AccessError } from "../auth";
import { readReceipt } from "../controle/extract";
import {
  isReceiptPath, maxReceiptBytes, receiptExt, receiptMime, receiptPath, type ReceiptMime,
} from "../controle/receipts";
import { todayInBrazil, type PurchaseDraft, type PurchaseInput, type SaleInput } from "../controle/schema";
import type { EntryStatus } from "../controle/status";
import {
  deletePurchase, deleteSale, findReceipt, insertPurchase, insertSale, orgModules, receiptInUse, setEntryStatus, updatePurchase, updateSale, type Space,
} from "../data/controle";
import { storage } from "../storage";
import { clientFolder } from "../storage-keys";
import { UserFacingError } from "./datasets";

export const CONTROLE_MODULE = "controle";

export interface ControleAccess {
  ctx: ClientContext;
  space: Space;
  /** May add and delete entries (org admins/editors and the client's analysts); others only look. */
  canRecord: boolean;
}

/** Whether the organization has the module on. */
export async function controleEnabled(orgId: string): Promise<boolean> {
  return (await orgModules(orgId)).includes(CONTROLE_MODULE);
}

/** The client's "controle" for the current user; 404 when the module is off or the client is not visible. */
export async function getControle(orgSlug: string, clientSlug: string): Promise<ControleAccess> {
  const ctx = await getClientContext(orgSlug, clientSlug);
  if (!(await controleEnabled(ctx.org.id))) throw new AccessError(404, "Não encontrado.");
  return { ctx, space: { orgId: ctx.org.id, clientId: ctx.client.id }, canRecord: ctx.actions.has("record") };
}

/** Same, for actions that change something: 403 when the person may only look. */
export async function requireRecord(orgSlug: string, clientSlug: string): Promise<ControleAccess> {
  const access = await getControle(orgSlug, clientSlug);
  requireAction(access.ctx.actions, "record");
  return access;
}

// ---------- receipts ----------

const receiptKey = (access: ControleAccess, path: string): string => {
  if (!isReceiptPath(path)) throw new UserFacingError("Comprovante inválido.");
  return `${clientFolder(access.ctx.org.slug, access.ctx.client.slug)}${path}`;
};

function newReceiptPath(mime: string, size: number): { path: string; mime: ReceiptMime } {
  const ext = receiptExt(mime);
  if (!ext) throw new UserFacingError("Envie uma foto (JPG, PNG, WebP) ou um PDF.");
  if (size <= 0) throw new UserFacingError("Arquivo vazio.");
  if (size > maxReceiptBytes(mime)) throw new UserFacingError("Arquivo grande demais (até 4 MB para foto, 10 MB para PDF).");
  const path = receiptPath(todayInBrazil().slice(0, 7), randomUUID(), ext);
  return { path, mime: receiptMime(path) as ReceiptMime };
}

export type ReceiptUploadPlan =
  | { mode: "direct" }
  | { mode: "signed"; path: string; mime: ReceiptMime; signedUrl: string };

/** How the browser should send a receipt: straight to the bucket (cloud) or in the next request (local disk). */
export async function planReceiptUpload(access: ControleAccess, mime: string, size: number): Promise<ReceiptUploadPlan> {
  const receipt = newReceiptPath(mime, size);
  const target = await storage.createUploadTarget(receiptKey(access, receipt.path));
  return target ? { mode: "signed", ...receipt, signedUrl: target.signedUrl } : { mode: "direct" };
}

/** Local storage only: the file comes in the request body (cloud storage always goes through the pre-signed URL). */
export async function storeReceipt(access: ControleAccess, file: File): Promise<{ path: string; mime: ReceiptMime }> {
  if (storage.remote()) throw new UserFacingError("Envie o comprovante pelo aplicativo.");
  const receipt = newReceiptPath(file.type, file.size);
  await storage.putBytes(receiptKey(access, receipt.path), new Uint8Array(await file.arrayBuffer()), receipt.mime);
  return receipt;
}

async function receiptBytes(access: ControleAccess, path: string): Promise<Uint8Array> {
  const bytes = await storage.read(receiptKey(access, path)).catch((err: unknown) => {
    console.error("[controle] could not read receipt", path, err);
    throw new UserFacingError("O comprovante não chegou ao armazenamento. Envie de novo.");
  });
  // A pre-signed upload is not size-checked by the bucket; this is where an oversized file stops (and goes away).
  if (bytes.byteLength === 0 || bytes.byteLength > maxReceiptBytes(receiptMime(path) ?? "")) {
    if (!(await receiptInUse(access.space.clientId, path))) await storage.remove([receiptKey(access, path)]);
    throw new UserFacingError("Comprovante vazio ou grande demais. Envie de novo.");
  }
  return bytes;
}

/** Reads a stored receipt with AI and returns the draft to be checked on the screen. Saves nothing. */
export async function extractReceipt(access: ControleAccess, path: string): Promise<PurchaseDraft> {
  const mime = receiptMime(path);
  if (!mime) throw new UserFacingError("Comprovante inválido.");
  return readReceipt(await receiptBytes(access, path), mime);
}

/** The receipt of a saved purchase, to show it. Anyone who may view the client may open it. */
export async function openReceipt(access: ControleAccess, purchaseId: string): Promise<{ bytes: Uint8Array; mime: ReceiptMime }> {
  const stored = await findReceipt(access.space.clientId, purchaseId);
  const mime = stored ? receiptMime(stored.path) : null;
  if (!stored || !mime) throw new AccessError(404, "Não encontrado.");
  return { bytes: await receiptBytes(access, stored.path), mime };
}

// ---------- entries ----------

export async function savePurchase(access: ControleAccess, input: PurchaseInput): Promise<{ id: string }> {
  if (input.receipt) {
    const mime = receiptMime(input.receipt.path);
    if (!mime) throw new UserFacingError("Comprovante inválido.");
    if (await receiptInUse(access.space.clientId, input.receipt.path)) throw new UserFacingError("Este comprovante já foi lançado.");
    await receiptBytes(access, input.receipt.path); // the file must really be in this client's folder
    try {
      return { id: await insertPurchase(access.space, access.ctx.user.id, { ...input, receipt: { path: input.receipt.path, mime } }) };
    } catch (err) {
      // Two saves of the same receipt at once: the unique index lets only one through.
      if ((err as { code?: string }).code === "23505") throw new UserFacingError("Este comprovante já foi lançado.");
      throw err;
    }
  }
  return { id: await insertPurchase(access.space, access.ctx.user.id, { ...input, fromReceipt: false }) };
}

/** Corrects a saved purchase. Its receipt (and whether it came from the reader) is not touched. */
export async function editPurchase(access: ControleAccess, purchaseId: string, input: PurchaseInput): Promise<void> {
  if (!(await updatePurchase(access.space.clientId, purchaseId, input))) throw new UserFacingError("Esta despesa não existe mais.");
}

export async function removePurchase(access: ControleAccess, purchaseId: string): Promise<void> {
  const { found, receiptPath: path } = await deletePurchase(access.space.clientId, purchaseId);
  if (!found) throw new UserFacingError("Esta despesa não existe mais.");
  if (path && isReceiptPath(path)) await storage.remove([receiptKey(access, path)]); // never throws: the entry is already gone
}

/** Drops a receipt that was sent but never became a purchase (the person gave up on the draft). */
export async function discardReceipt(access: ControleAccess, path: string): Promise<void> {
  const key = receiptKey(access, path);
  if (await receiptInUse(access.space.clientId, path)) return;
  await storage.remove([key]);
}

export async function saveSale(access: ControleAccess, input: SaleInput): Promise<{ id: string }> {
  return { id: await insertSale(access.space, access.ctx.user.id, input) };
}

export async function editSale(access: ControleAccess, saleId: string, input: SaleInput): Promise<void> {
  if (!(await updateSale(access.space.clientId, saleId, input))) throw new UserFacingError("Esta venda não existe mais.");
}

/** Confirms that an entry happened (or puts it back as pending). */
export async function changeStatus(access: ControleAccess, kind: "venda" | "despesa", id: string, status: EntryStatus): Promise<void> {
  if (!(await setEntryStatus(access.space.clientId, kind, id, status))) {
    throw new UserFacingError(kind === "venda" ? "Esta venda não existe mais." : "Esta despesa não existe mais.");
  }
}

export async function removeSale(access: ControleAccess, saleId: string): Promise<void> {
  if (!(await deleteSale(access.space.clientId, saleId))) throw new UserFacingError("Esta venda não existe mais.");
}
