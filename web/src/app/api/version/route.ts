import { resolveAppVersion } from "@/lib/app-version";

export const dynamic = "force-dynamic";

/**
 * The version being served right now (see lib/app-version). Public and never cached: an open screen
 * asks it to find out whether a newer DBI was published since it was loaded.
 */
export function GET(): Response {
  return Response.json({ version: resolveAppVersion(process.env) }, { headers: { "Cache-Control": "no-store" } });
}
