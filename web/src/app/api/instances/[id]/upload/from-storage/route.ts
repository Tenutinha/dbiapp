import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { importFolder, previewFolder } from "@/lib/services/storage-import";
import { fail, handleError, instanceParams } from "../respond";

export const runtime = "nodejs";
/** Downloading and validating several tables can take a while. */
export const maxDuration = 300;

const body = z.object({
  /** Folder relative to the organization's storage folder, e.g. "preparado/deputados". */
  folder: z.string().trim().max(300),
  /** false = only show which files match the contract; true = import them into the draft. */
  importar: z.boolean().default(false),
});

/** Feeds a dashboard's draft from files that are already in the organization's storage folder. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const input = body.parse(await req.json());
    if (!input.importar) return NextResponse.json({ success: true, data: await previewFolder(access, input.folder) });

    const result = await importFolder(access, input.folder);
    const failed = result.reports.find((r) => !r.ok);
    return NextResponse.json(
      { success: !failed, data: result, error: failed ? `${failed.table}: ${failed.errors[0] ?? "arquivo recusado"}` : undefined },
      { status: failed ? 422 : 200 },
    );
  } catch (err) {
    return handleError(err, "upload-from-storage");
  }
}
