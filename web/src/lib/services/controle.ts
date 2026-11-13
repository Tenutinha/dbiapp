/**
 * The "controle" module: a client's own people record purchases (with the proof kept and read by AI)
 * and sales. It exists only in organizations that have the module on; elsewhere every entry point
 * answers 404, like any other thing the person may not see.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { getClientContext, requireAction, type ClientContext } from "../access";
import { AccessError } from "../auth";
import { readNfcePage, readReceipt } from "../controle/extract";
import {
  isReceiptPath, maxReceiptBytes, receiptExt, receiptMime, receiptPath, type ReceiptMime,
} from "../controle/receipts";
import { describeKey, formatCnpj, isValidKey, pageText, parseNfceQr } from "../controle/nfce";
import { parseNfceItems, withPageItems } from "../controle/nfce-items";
import { fetchNfcePage } from "../controle/nfce-page";
import { purchaseInput, todayInBrazil, type PurchaseDraft, type PurchaseInput, type SaleInput } from "../controle/schema";
import type { EntryStatus } from "../controle/status";
import {
  deletePurchase, deleteSale, findReceipt, insertPurchase, insertSale, orgModules, nfceInUse, receiptInUse, setEntryStatus, updatePurchase, updateSale, type Space,
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

const NOTE_ALREADY_IN = "Esta nota já foi lançada.";
const RECEIPT_ALREADY_IN = "Este comprovante já foi lançado.";

export async function savePurchase(access: ControleAccess, input: PurchaseInput): Promise<{ id: string }> {
  const clientId = access.space.clientId;
  if (input.nfceKey) {
    if (!isValidKey(input.nfceKey)) throw new UserFacingError("Chave da nota inválida.");
    if (await nfceInUse(clientId, input.nfceKey)) throw new UserFacingError(NOTE_ALREADY_IN);
  }
  let receipt: PurchaseInput["receipt"] = null;
  if (input.receipt) {
    const mime = receiptMime(input.receipt.path);
    if (!mime) throw new UserFacingError("Comprovante inválido.");
    if (await receiptInUse(clientId, input.receipt.path)) throw new UserFacingError(RECEIPT_ALREADY_IN);
    await receiptBytes(access, input.receipt.path); // the file must really be in this client's folder
    receipt = { path: input.receipt.path, mime };
  }
  // "Read by AI" only when there is something it read: a receipt or an NFC-e page.
  const fromReceipt = input.fromReceipt && (receipt !== null || input.nfceKey !== null);
  try {
    return { id: await insertPurchase(access.space, access.ctx.user.id, { ...input, receipt, fromReceipt }) };
  } catch (err) {
    // Two saves of the same receipt or note at once: the unique indexes let only one through.
    const { code, constraint_name } = err as { code?: string; constraint_name?: string };
    if (code === "23505") throw new UserFacingError(constraint_name?.includes("nfce") ? NOTE_ALREADY_IN : RECEIPT_ALREADY_IN);
    throw err;
  }
}

export type NfceImport =
  /** The note was read and saved as a paid expense. */
  | { saved: true; id: string; draft: PurchaseDraft; key: string }
  /** Read, but something is missing (or the SEFAZ did not show the note): the person checks it first. */
  | { saved: false; draft: PurchaseDraft; key: string; notice: string };

/**
 * An expense from the QR Code of an NFC-e: the note's public page on the SEFAZ is read and, when
 * it brings date and total, saved right away as paid (with the photo, when there is one).
 */
export async function importNfce(access: ControleAccess, qr: string, receipt: PurchaseInput["receipt"]): Promise<NfceImport> {
  const nfce = parseNfceQr(qr);
  if (!nfce) throw new UserFacingError("Este QR Code não é de uma NFC-e.");
  if (await nfceInUse(access.space.clientId, nfce.key)) throw new UserFacingError(NOTE_ALREADY_IN);

  const html = await fetchNfcePage(nfce.url);
  // The AI reads store, date, total and payment; the items come straight from the page when its layout is known.
  const read = withPageItems(await readNfcePage(pageText(html)), parseNfceItems(html));
  const info = describeKey(nfce.key);
  const draft: PurchaseDraft = { ...read, supplier: read.supplier ?? `CNPJ ${formatCnpj(info.cnpj)}`, status: "efetivado" };
  if (!read.readable) {
    return { saved: false, draft, key: nfce.key, notice: `O site da SEFAZ não mostrou a nota${read.notes ? ` (${read.notes})` : ""}.` };
  }
  const input = purchaseInput.safeParse({
    purchasedOn: draft.purchasedOn, supplier: draft.supplier, totalCents: draft.totalCents, paymentMethod: draft.paymentMethod,
    notes: draft.notes, receipt, fromReceipt: true, status: "efetivado", nfceKey: nfce.key, items: draft.items,
  });
  if (!input.success || draft.totalCents === null || draft.purchasedOn === null) {
    return { saved: false, draft, key: nfce.key, notice: "Li a nota na SEFAZ, mas faltou algum dado. Confira antes de salvar." };
  }
  const { id } = await savePurchase(access, input.data);
  return { saved: true, id, draft, key: nfce.key };
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
  if (!(await updateSale(access.space.clientId, saleId, input))) throw new UserFacingError("Esta receita não existe mais.");
}

/** Confirms that an entry happened (or puts it back as pending). */
export async function changeStatus(access: ControleAccess, kind: "venda" | "despesa", id: string, status: EntryStatus): Promise<void> {
  if (!(await setEntryStatus(access.space.clientId, kind, id, status))) {
    throw new UserFacingError(kind === "venda" ? "Esta receita não existe mais." : "Esta despesa não existe mais.");
  }
}

export async function removeSale(access: ControleAccess, saleId: string): Promise<void> {
  if (!(await deleteSale(access.space.clientId, saleId))) throw new UserFacingError("Esta receita não existe mais.");
}
