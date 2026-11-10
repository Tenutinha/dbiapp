import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgStorage, storeUpload } from "@/lib/services/org-storage";
import { fail, handleError } from "../../../../instances/[id]/upload/respond";

export const runtime = "nodejs";

const params = z.object({ org: z.string().regex(/^[a-z0-9-]{1,40}$/) });
const folder = z.string().trim().max(500);

/** Direct upload (local storage only; the bucket gets files straight from the browser): one file into a folder. */
export async function POST(req: Request, ctx: { params: Promise<{ org: string }> }) {
  const p = params.safeParse(await ctx.params);
  if (!p.success) return fail(404, "Organização não encontrada.");
  try {
    const org = await requireOrgStorage(p.data.org);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "Envie um arquivo.");
    return NextResponse.json({ success: true, data: await storeUpload(org.org, folder.parse(form.get("folder") ?? ""), file) });
  } catch (err) {
    unstable_rethrow(err);
    return handleError(err, "org-storage-store");
  }
}
