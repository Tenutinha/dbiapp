import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { uploadTable, UserFacingError } from "@/lib/services/datasets";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
const formSchema = z.object({ table: z.string().regex(/^[a-z_][a-z0-9_]*$/) });

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function fail(status: number, error: string): NextResponse<Envelope<never>> {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");

  try {
    const access = await requireInstance(params.data.id, "manageData");
    const form = await req.formData();
    const meta = formSchema.safeParse({ table: form.get("table") });
    const file = form.get("file");
    if (!meta.success || !(file instanceof File)) return fail(400, "Envie o campo 'table' e um arquivo.");

    const report = await uploadTable(access, meta.data.table, file);
    return NextResponse.json({ success: report.ok, data: report, error: report.errors[0] }, { status: report.ok ? 200 : 422 });
  } catch (err) {
    if (err instanceof AccessError) return fail(err.status, err.message);
    if (err instanceof UserFacingError) return fail(400, err.message);
    console.error("[upload] unexpected error", err);
    return fail(500, "Falha ao processar o arquivo.");
  }
}
