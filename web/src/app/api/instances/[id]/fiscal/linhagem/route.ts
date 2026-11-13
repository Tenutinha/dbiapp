import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { requireImporter } from "@/lib/services/fiscal";
import { loadLineage, loadLineageSources } from "@/lib/services/fiscal-panel";
import { fail, handleError, instanceParams, tableName } from "../../upload/respond";

export const runtime = "nodejs";

const query = z.object({
  versao: z.enum(["publicada", "rascunho"]).default("publicada"),
  tabela: tableName.optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const PAGE = 100;

/**
 * Lineage of a fiscal dashboard, for everyone who views it: without `tabela`, one summary per table;
 * with it, the files that table came from, a page at a time.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "view");
    requireImporter(access);
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    // What is not published yet is seen only by who manages the data.
    if (q.versao === "rascunho" && !access.actions.has("manageData")) return fail(403, "Seu papel não permite esta ação.");
    if (q.tabela) {
      const page = await loadLineageSources(access, q.versao, q.tabela, q.offset, PAGE);
      if (!page) return fail(404, "Linhagem não encontrada.");
      return NextResponse.json({ success: true, data: { ...page, offset: q.offset, limit: PAGE } });
    }
    return NextResponse.json({ success: true, data: await loadLineage(access, q.versao) });
  } catch (err) {
    return handleError(err, "fiscal-linhagem");
  }
}
