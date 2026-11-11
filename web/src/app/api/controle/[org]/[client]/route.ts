import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { purchaseInput, saleInput } from "@/lib/controle/schema";
import {
  discardReceipt, extractReceipt, planReceiptUpload, removePurchase, removeSale, requireRecord, savePurchase, saveSale,
} from "@/lib/services/controle";
import { fail, handleError } from "../../../instances/[id]/upload/respond";
import { spaceParams } from "./params";

export const runtime = "nodejs";
/** Reading a receipt waits for the AI (usually 5–20 s; long PDFs take more). */
export const maxDuration = 120;

const receiptPath = z.string().min(1).max(200);
const id = z.string().uuid();

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("receiptPlan"), mime: z.string().min(1).max(60), size: z.number().int().nonnegative() }),
  z.object({ action: z.literal("receiptRead"), path: receiptPath }),
  z.object({ action: z.literal("receiptDiscard"), path: receiptPath }),
  z.object({ action: z.literal("purchaseSave"), purchase: purchaseInput }),
  z.object({ action: z.literal("purchaseRemove"), id }),
  z.object({ action: z.literal("saleSave"), sale: saleInput }),
  z.object({ action: z.literal("saleRemove"), id }),
]);

/**
 * Everything the "controle" screens change for one client: plan and read a receipt, save and delete
 * purchases and sales. Only people who may record entries for that client, in an organization with the module on.
 */
export async function POST(req: Request, ctx: { params: Promise<{ org: string; client: string }> }) {
  const params = spaceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Não encontrado.");
  try {
    const access = await requireRecord(params.data.org, params.data.client);
    const input = body.parse(await req.json());
    const data = await (async () => {
      switch (input.action) {
        case "receiptPlan": return planReceiptUpload(access, input.mime, input.size);
        case "receiptRead": return extractReceipt(access, input.path);
        case "receiptDiscard": return discardReceipt(access, input.path);
        case "purchaseSave": return savePurchase(access, input.purchase);
        case "purchaseRemove": return removePurchase(access, input.id);
        case "saleSave": return saveSale(access, input.sale);
        case "saleRemove": return removeSale(access, input.id);
      }
    })();
    return NextResponse.json({ success: true, data: data ?? null });
  } catch (err) {
    unstable_rethrow(err);
    return handleError(err, "controle");
  }
}
