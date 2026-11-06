import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { planUpload } from "@/lib/services/datasets";
import { fail, fileName, handleError, instanceParams, tableName } from "../respond";

export const runtime = "nodejs";

const body = z.object({ table: tableName, fileName, size: z.number().int().nonnegative() });

/** Step 1: tells the browser how to send the file (direct POST, or a signed URL to Storage). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const input = body.parse(await req.json());
    const plan = await planUpload(access, input.table, input.fileName, input.size);
    return NextResponse.json({ success: true, data: plan });
  } catch (err) {
    return handleError(err, "upload-plan");
  }
}
