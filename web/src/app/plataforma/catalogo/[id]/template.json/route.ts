import { NextResponse } from "next/server";
import { AccessError, getCurrentUser } from "@/lib/auth";
import { getCatalogEntry } from "@/lib/templates/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download of a catalog template definition. Platform admins only (404 for everyone else). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const notFound = (): NextResponse => NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const user = await getCurrentUser();
    if (!user.isPlatformAdmin) return notFound();
  } catch (err) {
    if (err instanceof AccessError) return notFound();
    throw err;
  }
  const { id } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return notFound();
  const entry = await getCatalogEntry(id);
  if (!entry) return notFound();
  return new NextResponse(JSON.stringify(entry.template, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}.template.json"`,
      "Cache-Control": "no-store",
    },
  });
}
