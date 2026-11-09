import { NextResponse } from "next/server";
import { requireInstance } from "@/lib/access";
import { listFiscalPeriods, storeFiscalFile } from "@/lib/services/fiscal";
import { fail, handleError, instanceParams } from "../upload/respond";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Stored raw files of the dashboard, per company and period. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    return NextResponse.json({ success: true, data: await listFiscalPeriods(access) });
  } catch (err) {
    return handleError(err, "fiscal-list");
  }
}

/** Direct upload (local storage): the raw file comes in the request body. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return fail(400, "Envie um arquivo.");
    return NextResponse.json({ success: true, data: await storeFiscalFile(access, file) });
  } catch (err) {
    return handleError(err, "fiscal-direct");
  }
}
