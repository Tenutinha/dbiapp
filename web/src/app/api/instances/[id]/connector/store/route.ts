import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { storeFolderFile } from "@/lib/services/data-connector";
import { fail, handleError, instanceParams } from "../../upload/respond";

export const runtime = "nodejs";

const folder = z.string().trim().max(300);

/** Direct upload (local storage): stores the file in a folder of the organization's storage. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "Envie um arquivo.");
    const data = await storeFolderFile(access, folder.parse(form.get("folder") ?? ""), file);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return handleError(err, "connector-store");
  }
}
