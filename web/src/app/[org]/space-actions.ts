"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClientContext, getOrgContext, orgActions, requireAction } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { applyLayoutPlan, getSpaceLayout } from "@/lib/data/layout";
import { LayoutError, layoutDraftSchema, planLayout } from "@/lib/layout/toc";

export interface SaveLayoutResult {
  ok: boolean;
  message?: string;
}

const slug = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** Saves the sidebar of a space (organization or client). Org admins only. */
export async function saveLayoutAction(orgSlug: string, clientSlug: string | null, draft: unknown): Promise<SaveLayoutResult> {
  try {
    const org = slug.parse(orgSlug);
    let space: { orgId: string; clientId: string | null };
    if (clientSlug) {
      const ctx = await getClientContext(org, slug.parse(clientSlug));
      requireAction(ctx.actions, "admin");
      space = { orgId: ctx.org.id, clientId: ctx.client.id };
    } else {
      const ctx = await getOrgContext(org);
      requireAction(orgActions(ctx), "admin");
      space = { orgId: ctx.org.id, clientId: null };
    }

    const parsed = layoutDraftSchema.safeParse(draft);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };

    const current = await getSpaceLayout(space);
    const plan = planLayout(parsed.data, {
      sectionIds: current.sections.map((s) => s.id),
      dashboardIds: current.dashboards.map((d) => d.id),
    });
    await applyLayoutPlan(space, plan);
    revalidatePath(`/${org}`, "layout");
    return { ok: true };
  } catch (err) {
    if (err instanceof LayoutError || err instanceof AccessError) return { ok: false, message: err.message };
    console.error("[layout] save failed", err);
    return { ok: false, message: "Não foi possível salvar. Recarregue a página e tente de novo." };
  }
}
