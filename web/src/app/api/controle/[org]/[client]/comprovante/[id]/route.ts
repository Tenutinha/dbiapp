import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getControle, openReceipt } from "@/lib/services/controle";
import { fail, handleError } from "../../../../../instances/[id]/upload/respond";
import { spaceParams } from "../../params";

export const runtime = "nodejs";

const params = spaceParams.extend({ id: z.string().uuid() });

/** The stored proof of one purchase (photo or PDF), for whoever may view the client. */
export async function GET(_req: Request, ctx: { params: Promise<{ org: string; client: string; id: string }> }) {
  const parsed = params.safeParse(await ctx.params);
  if (!parsed.success) return fail(404, "Não encontrado.");
  try {
    const access = await getControle(parsed.data.org, parsed.data.client);
    const { bytes, mime } = await openReceipt(access, parsed.data.id);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
        // The file was sent by a person: never let the browser guess another type or run it as a page.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    unstable_rethrow(err);
    return handleError(err, "controle-receipt");
  }
}
