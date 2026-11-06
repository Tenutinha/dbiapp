import { NextResponse } from "next/server";
import { requireInstance } from "@/lib/access";
import { uploadTable } from "@/lib/services/datasets";
import { fail, handleError, instanceParams, tableName } from "./respond";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Direct upload (local storage): the file comes in the request body. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const form = await req.formData();
    const table = tableName.safeParse(form.get("table"));
    const file = form.get("file");
    if (!table.success || !(file instanceof File)) return fail(400, "Envie o campo 'table' e um arquivo.");

    const report = await uploadTable(access, table.data, file);
    return NextResponse.json({ success: report.ok, data: report, error: report.errors[0] }, { status: report.ok ? 200 : 422 });
  } catch (err) {
    return handleError(err, "upload");
  }
}
