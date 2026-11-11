import { NextResponse } from "next/server";
import { isValidSlug } from "@/lib/permissions";
import { appManifest } from "@/lib/pwa";

/**
 * The manifest of an organization's pages: the installed app is called "DBI-<organização>" and opens
 * on /<org>. Browsers fetch manifests without the session, so this reads nothing from the database:
 * the name comes in the address, written by the organization's own (signed-in) pages.
 */
export async function GET(req: Request, ctx: { params: Promise<{ org: string }> }) {
  const { org } = await ctx.params;
  if (!isValidSlug(org)) return new NextResponse(null, { status: 404 });
  const name = new URL(req.url).searchParams.get("nome") ?? "";
  return NextResponse.json(appManifest({ slug: org, name }), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}
