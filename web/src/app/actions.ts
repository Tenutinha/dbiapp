"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getClientContext, getOrgContext, orgActions, requireAction, requireInstance } from "@/lib/access";
import { AccessError, DEV_USER_COOKIE, devAuthEnabled } from "@/lib/auth";
import { linkDashboard } from "@/lib/data/instances";
import { createShareLink, revokeShareLink } from "@/lib/data/repository";
import { publishDraft, type PublishResult, UserFacingError } from "@/lib/services/datasets";
import { afterLink } from "@/lib/services/panel-activation";
import { isFiscalPanel } from "@/lib/fiscal/panel";
import { getCatalogEntry } from "@/lib/templates/registry";

export interface ActionResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

function toError(err: unknown): string {
  if (err instanceof AccessError || err instanceof UserFacingError) return err.message;
  console.error("[action] unexpected error", err);
  return "Algo deu errado. Tente novamente.";
}

const uuid = z.string().uuid();
const slug = z.string().regex(/^[a-z0-9-]{1,40}$/);

const activateSchema = z.object({
  templateId: z.string().regex(/^[a-z0-9-]+$/),
  org: slug,
  client: slug.optional(),
});

/** Activates a catalog template for the organization itself or for one of its clients. */
export async function activateTemplate(formData: FormData): Promise<void> {
  const input = activateSchema.parse({
    templateId: formData.get("templateId"),
    org: formData.get("org"),
    client: formData.get("client") || undefined,
  });
  const entry = await getCatalogEntry(input.templateId);
  if (!entry || entry.status !== "published") throw new UserFacingError("Este dashboard não está disponível no catálogo.");
  const { template } = entry;

  let orgId: string;
  let clientId: string | null = null;
  if (input.client) {
    const ctx = await getClientContext(input.org, input.client);
    requireAction(ctx.actions, "manageData");
    orgId = ctx.org.id;
    clientId = ctx.client.id;
  } else {
    const ctx = await getOrgContext(input.org);
    requireAction(orgActions(ctx), "manageData");
    orgId = ctx.org.id;
  }

  // Re-linking a dashboard that was unlinked from this space brings its data back.
  const { id, outcome } = await linkDashboard(orgId, clientId, template.id, template.name);
  if (outcome === "created") await afterLink(template.id, id);
  revalidatePath(`/${input.org}`, "layout");
  // The panel of fiscal data has no data of its own: it opens in its space.
  redirect(isFiscalPanel(template.id) ? `/${input.org}/d/${id}` : `/${input.org}/d/${id}/dados`);
}

function revalidateInstance(orgSlug: string, instanceId: string): void {
  revalidatePath(`/${orgSlug}`, "layout");
  revalidatePath(`/${orgSlug}/d/${instanceId}`, "layout");
}

export async function publishAction(instanceId: string): Promise<ActionResult<PublishResult>> {
  try {
    const access = await requireInstance(uuid.parse(instanceId), "manageData");
    const result = await publishDraft(access);
    if (result.ok) revalidateInstance(access.org.slug, access.instanceId);
    return { success: result.ok, data: result, error: result.errors[0] };
  } catch (err) {
    return { success: false, error: toError(err) };
  }
}

const EXPIRY_DAYS = { "1": 1, "7": 7, "30": 30, never: null } as const;
const shareSchema = z.object({ instanceId: uuid, expiry: z.enum(["1", "7", "30", "never"]) });

export async function createShareAction(formData: FormData): Promise<void> {
  const input = shareSchema.parse({ instanceId: formData.get("instanceId"), expiry: formData.get("expiry") });
  const access = await requireInstance(input.instanceId, "share");
  const days = EXPIRY_DAYS[input.expiry];
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000);
  // 192 bits of entropy, URL-safe.
  const token = randomBytes(24).toString("base64url");
  await createShareLink(access.instanceId, access.user.id, token, expiresAt);
  revalidatePath(`/${access.org.slug}/d/${access.instanceId}/compartilhar`);
}

export async function revokeShareAction(formData: FormData): Promise<void> {
  const instanceId = uuid.parse(formData.get("instanceId"));
  const linkId = uuid.parse(formData.get("linkId"));
  const access = await requireInstance(instanceId, "share");
  await revokeShareLink(access.instanceId, linkId);
  revalidatePath(`/${access.org.slug}/d/${access.instanceId}/compartilhar`);
}

/** Dev-only "entrar como". Never available in production builds. */
export async function devSwitchUser(formData: FormData): Promise<void> {
  if (!devAuthEnabled()) throw new AccessError(403, "Indisponível.");
  const userId = uuid.parse(formData.get("userId"));
  (await cookies()).set(DEV_USER_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}
