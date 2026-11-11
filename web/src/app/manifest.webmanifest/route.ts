import { NextResponse } from "next/server";
import { appManifest } from "@/lib/pwa";

export const dynamic = "force-static";

/**
 * Makes DBI installable ("Add to home screen"): once installed it opens full screen, like an app.
 * Linked from the pages outside an organization (root layout); the pages of an organization link
 * their own (see [org]/app.webmanifest). A route, not Next's manifest.ts convention: that one
 * cannot be overridden by the metadata of a nested layout.
 */
export function GET() {
  return NextResponse.json(appManifest(), { headers: { "Content-Type": "application/manifest+json" } });
}
