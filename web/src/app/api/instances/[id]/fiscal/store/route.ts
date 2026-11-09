import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { storeFiscalUpload } from "@/lib/services/fiscal";
import { fail, fileName, handleError, instanceParams } from "../../upload/respond";

export const runtime = "nodejs";
export const maxDuration = 120;

const body = z.object({ key: z.string().max(200), fileName });

/** Step 2 (signed uploads): the file is in Storage — identify it and keep it in its company/period folder. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const input = body.parse(await req.json());
    return NextResponse.json({ success: true, data: await storeFiscalUpload(access, input.key, input.fileName) });
  } catch (err) {
    return handleError(err, "fiscal-store");
  }
}
