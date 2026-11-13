import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { requireTemplate, UserFacingError } from "@/lib/services/datasets";
import { findStoredFile, requireImporter } from "@/lib/services/fiscal";
import { readSpedFile } from "@/lib/services/fiscal-parts";
import { fail, handleError, instanceParams } from "../../upload/respond";

export const runtime = "nodejs";
/** One file of up to 250 MB is read here. */
export const maxDuration = 300;

const body = z.object({ key: z.string().min(1).max(1024) });

/**
 * Panel of fiscal data: reads one stored raw SPED file into its parts (one request per file, so the
 * screen shows "37 de 103" and a closed page resumes where it stopped). The tables are not touched.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const importer = requireImporter(access);
    if (importer.mode !== "sped") throw new UserFacingError("Este dashboard lê os arquivos todos de uma vez: use Montar tabelas.");
    const input = body.parse(await req.json());
    const file = await findStoredFile(access, input.key);
    if (!file) return fail(404, "Arquivo não encontrado. Atualize o painel.");
    const result = await readSpedFile(access, importer, await requireTemplate(access.templateId), file);
    return NextResponse.json({ success: result.ok, data: result, error: result.ok ? undefined : result.error }, { status: result.ok ? 200 : 422 });
  } catch (err) {
    return handleError(err, "fiscal-ler");
  }
}
