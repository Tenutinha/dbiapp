import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { planFiscalUpload } from "@/lib/services/fiscal";
import { fail, fileName, handleError, instanceParams } from "../../upload/respond";

export const runtime = "nodejs";

const body = z.object({ fileName, size: z.number().int().nonnegative() });

/** Step 1: how the browser sends a raw fiscal file (direct POST, or a signed URL to Storage). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const input = body.parse(await req.json());
    return NextResponse.json({ success: true, data: await planFiscalUpload(access, input.fileName, input.size) });
  } catch (err) {
    return handleError(err, "fiscal-plan");
  }
}
