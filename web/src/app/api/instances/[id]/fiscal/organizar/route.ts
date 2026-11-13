import { NextResponse } from "next/server";
import { requireInstance } from "@/lib/access";
import { adoptLooseFiles } from "@/lib/services/fiscal";
import { fail, handleError, instanceParams } from "../../upload/respond";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Panel of fiscal data: files the loose files this dashboard recognizes in their company/period folders. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    return NextResponse.json({ success: true, data: { adopted: await adoptLooseFiles(access) } });
  } catch (err) {
    return handleError(err, "fiscal-organizar");
  }
}
