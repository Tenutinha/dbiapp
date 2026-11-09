"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { spacePath, writeViewSelection } from "@/lib/view-selection";

const schema = z.object({ id: z.string().uuid() });

/**
 * Sidebar click on the viewing screen: opens that dashboard while the address stays the
 * space's own (`/<org>` or `/<org>/<client>`).
 */
export async function openDashboardAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  let target: string;
  try {
    const access = await requireInstance(parsed.data.id, "view");
    await writeViewSelection(access.client?.id ?? access.org.id, access.instanceId);
    target = spacePath(access.org.slug, access.client?.slug ?? null);
  } catch (err) {
    if (err instanceof AccessError && err.status === 401) redirect("/entrar");
    if (err instanceof AccessError) return; // Not visible (anymore): leave the screen as it is.
    throw err;
  }
  redirect(target);
}
