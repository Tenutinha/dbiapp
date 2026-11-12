import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { receiptRef } from "@/lib/controle/schema";
import { importNfce, requireRecord } from "@/lib/services/controle";
import { fail, handleError } from "../../../../instances/[id]/upload/respond";
import { spaceParams } from "../params";

export const runtime = "nodejs";
/** The SEFAZ page (up to 15 s) plus the AI reading of it. */
export const maxDuration = 90;
/** São Paulo: several state SEFAZ portals refuse requests from outside Brazil. */
export const preferredRegion = "gru1";

const body = z.object({
  /** What the QR Code of the receipt says (an address of a SEFAZ, checked in parseNfceQr). */
  qr: z.string().min(1).max(2000),
  /** The photo of the receipt, already stored, to keep with the expense. */
  receipt: receiptRef.nullish().transform((v) => v ?? null),
});

/** An expense from the QR Code of an NFC-e: reads the note on the SEFAZ and saves it (see importNfce). */
export async function POST(req: Request, ctx: { params: Promise<{ org: string; client: string }> }) {
  const params = spaceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Não encontrado.");
  try {
    const access = await requireRecord(params.data.org, params.data.client);
    const input = body.parse(await req.json());
    return NextResponse.json({ success: true, data: await importNfce(access, input.qr, input.receipt) });
  } catch (err) {
    unstable_rethrow(err);
    return handleError(err, "controle");
  }
}
