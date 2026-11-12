"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext, orgActions, requireAction, type OrgContext } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import {
  countAdmins, DuplicateSlugError, grantAccess, listClients, listOrgPeople, revokeClientRole, revokeOrgRole,
} from "@/lib/data/organizations";
import { createSpaceLink, LinkPasswordUnavailableError, revokeSpaceLinks, SpaceLinksUnavailableError } from "@/lib/data/space-links";
import { hashPassword, MAX_PASSWORD, MIN_PASSWORD } from "@/lib/link-password";
import { EXPIRY_CHOICES, expiryDate, type ExpiryChoice } from "@/lib/space-link";
import { createClientWithFolder, renameClientWithFolder } from "@/lib/services/client-folders";
import { clientNameSchema } from "@/lib/client-name";
import { CLIENT_ROLES, isValidSlug, ROLES, slugify } from "@/lib/permissions";
import { grantMessage, resendMessage } from "@/lib/access-invite";
import { sendAccessInvite } from "@/lib/services/access-invite";

export interface FormState {
  ok: boolean;
  message: string;
}

async function requireAdmin(orgSlug: string): Promise<OrgContext> {
  const ctx = await getOrgContext(orgSlug);
  requireAction(orgActions(ctx), "admin");
  return ctx;
}

function failure(err: unknown): FormState {
  if (err instanceof z.ZodError) return { ok: false, message: err.issues[0]?.message ?? "Dados inválidos." };
  if (err instanceof AccessError) return { ok: false, message: err.message };
  console.error("[admin] unexpected error", err);
  return { ok: false, message: "Algo deu errado. Tente novamente." };
}

const orgSlugSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

const clientSchema = z.object({
  org: orgSlugSchema,
  name: clientNameSchema,
  slug: z.string().trim().max(40).optional(),
});

const renameSchema = z.object({
  org: orgSlugSchema,
  clientId: z.string().uuid(),
  name: clientNameSchema,
  slug: z.string().trim().toLowerCase().max(40).optional(),
});

/**
 * Renames a client: its name and its address (/<org>/<client>). A blank address follows the name.
 * Shared links (/s/…) keep working; only bookmarks of the old address stop opening.
 */
export async function renameClientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const input = renameSchema.parse({
      org: formData.get("org"), clientId: formData.get("clientId"), name: formData.get("name"),
      slug: formData.get("slug") || undefined,
    });
    const ctx = await requireAdmin(input.org);
    const slug = input.slug || slugify(input.name);
    if (!isValidSlug(slug)) {
      return { ok: false, message: `Endereço "${slug}" inválido ou reservado. Use letras minúsculas, números e hífen.` };
    }
    if (!(await renameClientWithFolder(ctx.org, input.clientId, input.name, slug))) return { ok: false, message: "Cliente não encontrado." };
    revalidatePath(`/${ctx.org.slug}`, "layout");
    return { ok: true, message: `Salvo: ${input.name} · /${ctx.org.slug}/${slug}` };
  } catch (err) {
    if (err instanceof DuplicateSlugError) return { ok: false, message: `Já existe um cliente com o endereço "${err.message}".` };
    return failure(err);
  }
}

export async function createClientAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const input = clientSchema.parse({
      org: formData.get("org"), name: formData.get("name"), slug: formData.get("slug") || undefined,
    });
    const ctx = await requireAdmin(input.org);
    const slug = input.slug ? input.slug.toLowerCase() : slugify(input.name);
    if (!isValidSlug(slug)) {
      return { ok: false, message: `Endereço "${slug}" inválido ou reservado. Use letras minúsculas, números e hífen.` };
    }
    await createClientWithFolder(ctx.org, input.name, slug);
    revalidatePath(`/${ctx.org.slug}`, "layout");
    return { ok: true, message: `Cliente criado: /${ctx.org.slug}/${slug}` };
  } catch (err) {
    if (err instanceof DuplicateSlugError) return { ok: false, message: `Já existe um cliente com o endereço "${err.message}".` };
    return failure(err);
  }
}

const grantSchema = z
  .object({
    org: orgSlugSchema,
    email: z.string().trim().toLowerCase().email("E-mail inválido."),
    name: z.string().trim().min(2, "Informe o nome.").max(80),
    scope: z.string(), // "org" or a client id
    role: z.enum(ROLES),
  })
  .refine((v) => v.scope === "org" || z.string().uuid().safeParse(v.scope).success, "Escolha onde dar acesso.")
  .refine((v) => v.scope === "org" || (CLIENT_ROLES as readonly string[]).includes(v.role), {
    message: "Usuários de cliente só podem ser Analista ou Leitor.",
  });

export async function grantAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const input = grantSchema.parse(Object.fromEntries(["org", "email", "name", "scope", "role"].map((k) => [k, formData.get(k)])));
    const invite = formData.get("invite") === "on";
    const ctx = await requireAdmin(input.org);
    const clientId = input.scope === "org" ? null : input.scope;

    if (clientId === null && input.role !== "admin") {
      const target = (await listOrgPeople(ctx.org.id)).find((p) => p.email === input.email);
      if (target?.orgRole === "admin" && (await countAdmins(ctx.org.id)) <= 1) {
        return { ok: false, message: "A organização precisa de pelo menos um admin." };
      }
    }
    await grantAccess(ctx.org.id, { email: input.email, name: input.name, clientId, role: input.role });
    revalidatePath(`/${ctx.org.slug}`, "layout");
    // The access is saved either way; the e-mail only says how to get in (create the password).
    return grantMessage(input.email, invite ? await sendAccessInvite(input.email) : null);
  } catch (err) {
    return failure(err);
  }
}

const resendSchema = z.object({ org: orgSlugSchema, userId: z.string().uuid() });

/** "Reenviar convite": the "create your password" e-mail again, for someone of this organization. */
export async function resendInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const input = resendSchema.parse({ org: formData.get("org"), userId: formData.get("userId") });
    const ctx = await requireAdmin(input.org);
    const person = (await listOrgPeople(ctx.org.id)).find((p) => p.userId === input.userId);
    if (!person) return { ok: false, message: "Esta pessoa não tem mais acesso aqui." };
    return resendMessage(person.email, await sendAccessInvite(person.email));
  } catch (err) {
    return failure(err);
  }
}

const revokeSchema = z.object({
  org: orgSlugSchema,
  userId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
});

export async function revokeAccessAction(formData: FormData): Promise<void> {
  const input = revokeSchema.parse({
    org: formData.get("org"), userId: formData.get("userId"), clientId: formData.get("clientId") || undefined,
  });
  const ctx = await requireAdmin(input.org);
  if (input.clientId) {
    await revokeClientRole(ctx.org.id, input.clientId, input.userId);
  } else {
    const people = await listOrgPeople(ctx.org.id);
    const target = people.find((p) => p.userId === input.userId);
    if (target?.orgRole === "admin" && (await countAdmins(ctx.org.id)) <= 1) {
      throw new AccessError(403, "A organização precisa de pelo menos um admin.");
    }
    await revokeOrgRole(ctx.org.id, input.userId);
  }
  revalidatePath(`/${ctx.org.slug}`, "layout");
}

// ---------- public link of a whole space ("Acessos" column) ----------

const spaceLinkSchema = z.object({
  org: orgSlugSchema,
  /** "" = the organization's own space. */
  clientId: z.union([z.literal(""), z.string().uuid()]),
});

const expirySchema = z.enum(EXPIRY_CHOICES.map((c) => c.id) as [ExpiryChoice, ...ExpiryChoice[]]);

/** The space (organization or one of its clients) an admin acts on; a client id from another org is refused. */
async function spaceOf(formData: FormData): Promise<{ ctx: OrgContext; clientId: string | null }> {
  const input = spaceLinkSchema.parse({ org: formData.get("org"), clientId: formData.get("clientId") ?? "" });
  const ctx = await requireAdmin(input.org);
  if (input.clientId === "") return { ctx, clientId: null };
  const clients = await listClients(ctx.org.id);
  if (!clients.some((c) => c.id === input.clientId)) throw new AccessError(404, "Cliente não encontrado.");
  return { ctx, clientId: input.clientId };
}

function linkFailure(err: unknown): FormState {
  if (err instanceof SpaceLinksUnavailableError) {
    return { ok: false, message: "Acesso por link indisponível: aplique a migração 014 no banco." };
  }
  if (err instanceof LinkPasswordUnavailableError) {
    return { ok: false, message: "Link com senha indisponível: aplique a migração 019 no banco." };
  }
  return failure(err);
}

/** Optional password of a space link (only its hash is stored). */
const passwordSchema = z
  .string()
  .min(MIN_PASSWORD, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`)
  .max(MAX_PASSWORD, "Senha longa demais.")
  .nullable();

/** Anyone with the link (and its password, when set) sees the space's published dashboards, read-only. A new link revokes the previous one. */
export async function createSpaceLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ctx, clientId } = await spaceOf(formData);
    const expiry = expirySchema.parse(formData.get("expiry") ?? "30");
    const password = passwordSchema.parse(formData.get("withPassword") === "on" ? formData.get("password") : null);
    // 192 bits of entropy, URL-safe (same as the dashboards' guest links).
    const token = randomBytes(24).toString("base64url");
    await createSpaceLink(ctx.org.id, clientId, ctx.user.id, token, expiryDate(expiry), password ? hashPassword(password) : null);
    revalidatePath(`/${ctx.org.slug}/admin`);
    return { ok: true, message: password ? "Link liberado com senha." : "Link liberado." };
  } catch (err) {
    return linkFailure(err);
  }
}

export async function revokeSpaceLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ctx, clientId } = await spaceOf(formData);
    await revokeSpaceLinks(ctx.org.id, clientId);
    revalidatePath(`/${ctx.org.slug}/admin`);
    return { ok: true, message: "Link revogado: ele não abre mais." };
  } catch (err) {
    return linkFailure(err);
  }
}
