import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { ingestUploaded } from "@/lib/services/datasets";
import { fail, fileName, handleError, instanceParams, tableName } from "../respond";

export const runtime = "nodejs";
/** Validating and converting a large file can take a while. */
export const maxDuration = 300;

const body = z.object({ table: tableName, key: z.string().max(200), fileName });

/** Step 2 (signed uploads): the file is in Storage — validate it against the contract and add it to the draft. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const input = body.parse(await req.json());
    const report = await ingestUploaded(access, input.table, input.key, input.fileName);
    return NextResponse.json({ success: report.ok, data: report, error: report.errors[0] }, { status: report.ok ? 200 : 422 });
  } catch (err) {
    return handleError(err, "upload-ingest");
  }
}
