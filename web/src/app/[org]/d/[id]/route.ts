import { NextResponse, type NextRequest } from "next/server";
import { requireInstance } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { spacePath, writeViewSelection } from "@/lib/view-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ org: string; id: string }>;
}

/**
 * Old dashboard address (`/<org>/d/<id>`, still used by links and "Abrir dashboard"): remembers
 * the dashboard and sends to the space's fixed viewing address, keeping the filters.
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { org, id } = await ctx.params;
  try {
    const access = await requireInstance(id, "view", org);
    if (!access.activeVersionId) {
      const dest = access.actions.has("manageData") ? `/${org}/d/${id}/dados` : spacePath(org, access.client?.slug ?? null);
      return NextResponse.redirect(new URL(dest, req.url));
    }
    await writeViewSelection(access.client?.id ?? access.org.id, access.instanceId);
    const dest = new URL(spacePath(access.org.slug, access.client?.slug ?? null), req.url);
    dest.search = req.nextUrl.search;
    return NextResponse.redirect(dest);
  } catch (err) {
    if (err instanceof AccessError && err.status === 401) return NextResponse.redirect(new URL("/entrar", req.url));
    if (err instanceof AccessError) return new NextResponse("Não encontrado.", { status: 404 });
    console.error("[dashboard] could not open", id, err);
    return new NextResponse("Algo deu errado.", { status: 500 });
  }
}
