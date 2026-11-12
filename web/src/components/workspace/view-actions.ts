"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireInstance } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { spacePath, writeViewSelection } from "@/lib/view-selection";

const schema = z.object({ id: z.string().uuid() });

/**
 * Marks the dashboard as the one this space opens on and answers the address to go to: the space's own
 * (`/<org>` or `/<org>/<client>`), "/entrar" when the session is gone, or null when the dashboard is not
 * visible (anymore), to leave the screen as it is.
 */
async function select(id: unknown): Promise<string | null> {
  const parsed = schema.safeParse({ id });
  if (!parsed.success) return null;
  try {
    const access = await requireInstance(parsed.data.id, "view");
    await writeViewSelection(access.client?.id ?? access.org.id, access.instanceId);
    return spacePath(access.org.slug, access.client?.slug ?? null);
  } catch (err) {
    if (err instanceof AccessError && err.status === 401) return "/entrar";
    if (err instanceof AccessError) return null;
    throw err;
  }
}

/**
 * Sidebar click with the page's scripts running: picks the dashboard and answers where to go, and the
 * browser's router goes there. Not a redirect from here on purpose: a redirect makes the server fetch the
 * new page from itself, and when that inner fetch does not come back as page data (as on the hosting)
 * Next falls back to reloading the whole document, a white screen between two dashboards.
 */
export async function selectDashboardAction(id: string): Promise<string | null> {
  return select(id);
}

/** The same, as a plain form post: what works before the page's scripts load. */
export async function openDashboardAction(formData: FormData): Promise<void> {
  const target = await select(formData.get("id"));
  if (target !== null) redirect(target);
}
