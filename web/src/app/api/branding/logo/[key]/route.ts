import { findLogo } from "@/lib/data/branding";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public logo by unguessable id (logos also appear on guest links, which have no session).
 * The id changes on every upload, so responses are cached forever.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!UUID.test(key)) return new Response("Not found", { status: 404 });

  const logo = await findLogo(key);
  if (!logo) return new Response("Not found", { status: 404 });

  try {
    const body = await storage.read(logo.path);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": logo.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[logo] could not read", key, err);
    return new Response("Not found", { status: 404 });
  }
}
