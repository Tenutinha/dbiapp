import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { checkLocalFolder, localLoadState, startLocalLoad, stopLocalLoad } from "@/lib/services/local-load";
import { fail, handleError, instanceParams } from "../../upload/respond";

export const runtime = "nodejs";

const folder = z.string().trim().min(1).max(1000);
const startBody = z.object({ pasta: folder });

type Ctx = { params: Promise<{ id: string }> };

/**
 * "Converter nesta máquina" (local server only): where the dashboard's load stands and, with `?pasta=`,
 * what that folder has for the dashboard's files.
 */
export async function GET(req: Request, ctx: Ctx) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const asked = new URL(req.url).searchParams.get("pasta");
    const check = asked === null ? null : await checkLocalFolder(access, folder.parse(asked));
    return NextResponse.json({ success: true, data: { ...(await localLoadState(access)), check } });
  } catch (err) {
    return handleError(err, "fiscal-carga-local");
  }
}

/** Starts the load from the folder as a process of its own. */
export async function POST(req: Request, ctx: Ctx) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const body = startBody.parse(await req.json());
    return NextResponse.json({ success: true, data: { ...(await startLocalLoad(access, body.pasta)), check: null } });
  } catch (err) {
    return handleError(err, "fiscal-carga-local");
  }
}

/** Stops the load that is running. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    return NextResponse.json({ success: true, data: { ...(await stopLocalLoad(access)), check: null } });
  } catch (err) {
    return handleError(err, "fiscal-carga-local");
  }
}
