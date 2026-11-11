import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeFolder, organizeApply, organizePreview } from "@/lib/services/file-analysis";
import {
  createFolder, explorerMeta, listExplorerFolder, moveItems, planUpload, removeItems, renameItem, requireOrgStorage,
} from "@/lib/services/org-storage";
import { fail, fileName, handleError } from "../../../instances/[id]/upload/respond";

export const runtime = "nodejs";
/** Moving or deleting a big folder copies object by object. */
export const maxDuration = 300;

const orgParams = z.object({ org: z.string().regex(/^[a-z0-9-]{1,40}$/) });

/** Path relative to the organization's folder ("" = its root); validated again by the storage layer. */
const path = z.string().trim().max(500);
const paths = z.array(path.min(1)).min(1).max(500);
/** "Organizar" may list up to 5,000 files; the dialog sends them in batches (organize-batches), kept whole per destination. */
const organizePaths = z.array(path.min(1)).min(1).max(5000);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), folder: path }),
  z.object({ action: z.literal("meta") }),
  z.object({ action: z.literal("analyze"), folder: path }),
  z.object({ action: z.literal("organizePreview"), folder: path }),
  z.object({ action: z.literal("organizeApply"), folder: path, paths: organizePaths }),
  z.object({ action: z.literal("uploadPlan"), folder: path, file: fileName, size: z.number().int().nonnegative() }),
  z.object({ action: z.literal("mkdir"), folder: path, name: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal("rename"), path: path.min(1), name: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal("move"), paths, target: path }),
  z.object({ action: z.literal("remove"), paths }),
]);

/**
 * The organization's file explorer (admin "Arquivos"): list a folder, plan an upload, create folders,
 * rename, move and delete; analyse files (layout, ready or needs treatment) and file loose fiscal ones. Only org staff who manage data may call it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ org: string }> }) {
  const params = orgParams.safeParse(await ctx.params);
  if (!params.success) return fail(404, "Organização não encontrada.");
  try {
    const org = await requireOrgStorage(params.data.org);
    const input = body.parse(await req.json());
    const data = await (() => {
      switch (input.action) {
        case "list": return listExplorerFolder(org, input.folder);
        case "meta": return explorerMeta(org);
        case "analyze": return analyzeFolder(org, input.folder);
        case "organizePreview": return organizePreview(org, input.folder);
        case "organizeApply": return organizeApply(org, input.folder, input.paths);
        case "uploadPlan": return planUpload(org.org, input.folder, input.file, input.size);
        case "mkdir": return createFolder(org, input.folder, input.name);
        case "rename": return renameItem(org, input.path, input.name);
        case "move": return moveItems(org, input.paths, input.target);
        case "remove": return removeItems(org, input.paths);
      }
    })();
    return NextResponse.json({ success: true, data });
  } catch (err) {
    unstable_rethrow(err);
    return handleError(err, "org-storage");
  }
}
