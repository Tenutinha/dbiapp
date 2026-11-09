import { findAvatar } from "@/lib/data/users";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A person's avatar by its unguessable id (shown to colleagues in access lists, like space logos).
 * The id changes on every upload, so responses are cached forever.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!UUID.test(key)) return new Response("Not found", { status: 404 });

  const avatar = await findAvatar(key.toLowerCase());
  if (!avatar) return new Response("Not found", { status: 404 });

  try {
    const body = await storage.read(avatar.path);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": avatar.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[avatar] could not read", key, err);
    return new Response("Not found", { status: 404 });
  }
}
