import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireRecord, storeReceipt } from "@/lib/services/controle";
import { fail, handleError } from "../../../../../instances/[id]/upload/respond";
import { spaceParams } from "../../params";

export const runtime = "nodejs";

/** Local storage only: the receipt comes in the request body (cloud storage gets it through a pre-signed URL). */
export async function POST(req: Request, ctx: { params: Promise<{ org: string; client: string }> }) {
  const params = spaceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Não encontrado.");
  try {
    const access = await requireRecord(params.data.org, params.data.client);
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return fail(400, "Envie o comprovante.");
    return NextResponse.json({ success: true, data: await storeReceipt(access, file) });
  } catch (err) {
    unstable_rethrow(err);
    return handleError(err, "controle-receipt");
  }
}
