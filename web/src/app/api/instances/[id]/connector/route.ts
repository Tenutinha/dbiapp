import { NextResponse } from "next/server";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import type { TableReport } from "@/lib/ingest/ingest";
import {
  checkConnection, convertConnectionPart, discardConnectionParts, engageConnection, joinConnectionParts, listConnectorFolder,
  planFolderUpload,
} from "@/lib/services/data-connector";
import { fail, fileName, handleError, instanceParams, tableName } from "../upload/respond";

export const runtime = "nodejs";
/** Downloading and validating a large file can take a while. */
export const maxDuration = 300;

/** Folder relative to the organization's storage folder ("" = its root). */
const folder = z.string().trim().max(300);

/** Converted Parquet of one file (a key the "part" action returned). */
const partKey = z.string().min(1).max(400);
/** Files one table can be put together from. */
const MAX_PARTS = 60;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), folder }),
  z.object({ action: z.literal("check"), folder, file: fileName, table: tableName }),
  z.object({ action: z.literal("engage"), folder, file: fileName, table: tableName }),
  z.object({ action: z.literal("part"), folder, file: fileName, table: tableName }),
  z.object({
    action: z.literal("join"),
    table: tableName,
    parts: z.array(z.object({ key: partKey, file: fileName })).min(2).max(MAX_PARTS),
  }),
  z.object({ action: z.literal("discard"), table: tableName, keys: z.array(partKey).min(1).max(MAX_PARTS) }),
  z.object({ action: z.literal("uploadPlan"), folder, file: fileName, size: z.number().int().nonnegative() }),
]);

function reported(report: TableReport) {
  return NextResponse.json(
    { success: report.ok, data: report, error: report.ok ? undefined : report.errors[0] ?? "Arquivo recusado." },
    { status: report.ok ? 200 : 422 },
  );
}

/**
 * Data connector of one dashboard: list a folder of the organization's storage, check whether a file
 * fits a contract table, and engage it into the draft. A table fed by several files is engaged in steps:
 * "part" converts each file (one request per file) and "join" makes the table of the draft out of them.
 * Only staff who manage data may call it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = instanceParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Dashboard não encontrado.");
  try {
    const access = await requireInstance(params.data.id, "manageData");
    const input = body.parse(await req.json());
    if (input.action === "list") {
      return NextResponse.json({ success: true, data: await listConnectorFolder(access, input.folder) });
    }
    if (input.action === "uploadPlan") {
      return NextResponse.json({ success: true, data: await planFolderUpload(access, input.folder, input.file, input.size) });
    }
    if (input.action === "check") {
      return NextResponse.json({ success: true, data: await checkConnection(access, input.folder, input.file, input.table) });
    }
    if (input.action === "part") {
      return reported(await convertConnectionPart(access, input.folder, input.file, input.table));
    }
    if (input.action === "join") {
      return reported(await joinConnectionParts(access, input.table, input.parts));
    }
    if (input.action === "discard") {
      await discardConnectionParts(access, input.table, input.keys);
      return NextResponse.json({ success: true });
    }
    return reported(await engageConnection(access, input.folder, input.file, input.table));
  } catch (err) {
    return handleError(err, "connector");
  }
}
