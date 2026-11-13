"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canSeeDashboard } from "@/lib/permissions";
import { getOrgContext, orgActions, requireAction, requireInstance, type OrgContext } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { archiveDashboard, linkDashboard } from "@/lib/data/instances";
import { listClients } from "@/lib/data/organizations";
import { isFiscalPanel } from "@/lib/fiscal/panel";
import { afterLink } from "@/lib/services/panel-activation";
import { getCatalogEntry } from "@/lib/templates/registry";
import type { FormState } from "./actions";

async function requireAdmin(orgSlug: string): Promise<OrgContext> {
  const ctx = await getOrgContext(orgSlug);
  requireAction(orgActions(ctx), "admin");
  return ctx;
}

function failure(err: unknown): FormState {
  if (err instanceof z.ZodError) return { ok: false, message: err.issues[0]?.message ?? "Dados inválidos." };
  if (err instanceof AccessError) return { ok: false, message: err.message };
  console.error("[admin] dashboard link failed", err);
  return { ok: false, message: "Algo deu errado. Tente novamente." };
}

const orgSlug = z.string().regex(/^[a-z0-9-]{1,40}$/);

const linkSchema = z.object({
  org: orgSlug,
  scope: z.union([z.literal("org"), z.string().uuid()]),
  templateId: z.string().regex(/^[a-z0-9-]{1,80}$/, "Escolha um dashboard."),
});

/** Links a catalog dashboard to the organization or to one client (re-linking restores its data). */
export async function linkDashboardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const input = linkSchema.parse({
      org: formData.get("org"), scope: formData.get("scope"), templateId: formData.get("templateId"),
    });
    const ctx = await requireAdmin(input.org);

    const clientId = input.scope === "org" ? null : input.scope;
    if (clientId && !(await listClients(ctx.org.id)).some((c) => c.id === clientId)) {
      return { ok: false, message: "Cliente não encontrado." };
    }
    const entry = await getCatalogEntry(input.templateId);
    if (!entry || entry.status !== "published" || !canSeeDashboard(ctx.membership, entry.template.access)) return { ok: false, message: "Este dashboard não está disponível no catálogo." };

    const result = await linkDashboard(ctx.org.id, clientId, entry.template.id, entry.template.name);
    if (result.outcome === "created") await afterLink(entry.template.id, result.id);
    revalidatePath(`/${ctx.org.slug}`, "layout");
    const name = entry.template.name;
    if (result.outcome === "already-linked") return { ok: true, message: `"${name}" já estava vinculado.` };
    if (result.outcome === "restored") return { ok: true, message: `"${name}" vinculado de novo, com os dados que já tinha.` };
    if (isFiscalPanel(entry.template.id)) return { ok: true, message: `"${name}" vinculado: já aparece no espaço.` };
    return { ok: true, message: `"${name}" vinculado. Agora suba os arquivos em "Dados".` };
  } catch (err) {
    return failure(err);
  }
}

const unlinkSchema = z.object({ org: orgSlug, instanceId: z.string().uuid() });

/** Unlinks (archives) a dashboard: hidden from viewing; its data stays for a later re-link. */
export async function unlinkDashboardAction(formData: FormData): Promise<void> {
  const input = unlinkSchema.parse({ org: formData.get("org"), instanceId: formData.get("instanceId") });
  const ctx = await requireAdmin(input.org);
  // Also proves the dashboard belongs to this organization.
  await requireInstance(input.instanceId, "manageData", ctx.org.slug);
  await archiveDashboard(input.instanceId);
  revalidatePath(`/${ctx.org.slug}`, "layout");
}
