import { NextResponse } from "next/server";
import { requireInstance } from "@/lib/access";
import { rebuildFiscal } from "@/lib/services/fiscal";
import { fail, handleError, instanceParams } from "../../upload/respond";

export const runtime = "nodejs";
/** Reading every stored file and validating the tables can take a while. */
export const maxDuration = 300;

/** Reads every stored raw file into the template's tables and puts them in the draft. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const result = await rebuildFiscal(access);
    const firstError = result.tables.flatMap((t) => t.errors.map((e) => `${t.table}: ${e}`))[0];
    return NextResponse.json({ success: result.ok, data: result, error: firstError }, { status: result.ok ? 200 : 422 });
  } catch (err) {
    return handleError(err, "fiscal-rebuild");
  }
}
