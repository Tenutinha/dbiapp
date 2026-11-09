import { AccessError, getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether the element inspector (copy an element's description for development agents) is
 * shown: platform administrators only. Asked from the browser so public pages stay static.
 */
export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const user = await getCurrentUser();
    return Response.json({ enabled: user.isPlatformAdmin }, { headers });
  } catch (err) {
    if (!(err instanceof AccessError)) console.error("[dev-inspector] could not resolve user", err);
    return Response.json({ enabled: false }, { headers });
  }
}
