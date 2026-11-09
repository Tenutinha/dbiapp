import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { columnValues, loadDataFilter, previewDataFilter, saveDataFilter } from "@/lib/services/data-filter";
import { fail, handleError, instanceParams } from "../upload/respond";

export const runtime = "nodejs";

/** Rules are validated against the fact table by parseFactFilter; here only the envelope. */
const rules = z.array(z.unknown()).max(20);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("load") }),
  z.object({ action: z.literal("values"), column: z.string().max(80) }),
  z.object({ action: z.literal("preview"), filter: rules }),
  z.object({ action: z.literal("save"), filter: rules }),
]);

/** Data filter of a dashboard's fact table (which rows the dashboard shows). Staff who manage data only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const input = body.parse(await req.json());
    switch (input.action) {
      case "load":
        return NextResponse.json({ success: true, data: await loadDataFilter(access) });
      case "values":
        return NextResponse.json({ success: true, data: await columnValues(access, input.column) });
      case "preview":
        return NextResponse.json({ success: true, data: await previewDataFilter(access, input.filter) });
      case "save": {
        const filter = await saveDataFilter(access, input.filter);
        revalidatePath(`/${access.org.slug}`, "layout");
        return NextResponse.json({ success: true, data: filter });
      }
    }
  } catch (err) {
    return handleError(err, "data-filter");
  }
}
