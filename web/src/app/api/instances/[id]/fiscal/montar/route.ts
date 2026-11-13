import { NextResponse } from "next/server";
import { requireInstance } from "@/lib/access";
import { requireTemplate } from "@/lib/services/datasets";
import { rawFiles, rebuildFiscal, requireImporter } from "@/lib/services/fiscal";
import { assembleSpedFromParts } from "@/lib/services/fiscal-parts";
import { fail, handleError, instanceParams } from "../../upload/respond";

export const runtime = "nodejs";
/** Putting every table together from the parts can take a while. */
export const maxDuration = 300;

/**
 * Panel of fiscal data: puts the draft's tables together. SPED: only from the parts already read (refused
 * while files are still to be read); NF-e: every stored file is read, as in "Montar tabelas".
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const importer = requireImporter(access);
    const result = importer.mode === "sped"
      ? await assembleSpedFromParts(access, importer, await requireTemplate(access.templateId), await rawFiles(access))
      : await rebuildFiscal(access);
    const firstError = result.tables.flatMap((t) => t.errors.map((e) => `${t.table}: ${e}`))[0];
    const data = {
      ok: result.ok, files: result.files, skipped: result.skipped,
      tables: result.tables.map((t) => ({ table: t.table, ok: t.ok, rowCount: t.rowCount, errors: t.errors })),
    };
    return NextResponse.json({ success: result.ok, data, error: firstError }, { status: result.ok ? 200 : 422 });
  } catch (err) {
    return handleError(err, "fiscal-montar");
  }
}
