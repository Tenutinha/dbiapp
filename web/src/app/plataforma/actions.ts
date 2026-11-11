"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccessError, getCurrentUser } from "@/lib/auth";
import { createOrganization, deleteOrganization, DuplicateOrgSlugError, getOrganizationById } from "@/lib/data/platform";
import { isValidSlug, slugify } from "@/lib/permissions";
import { storage } from "@/lib/storage";
import { orgFolder } from "@/lib/storage-keys";

export interface PlatformFormState {
  ok: boolean;
  message: string;
}

const schema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome da organização.").max(80),
    slug: z.string().trim().toLowerCase().max(40).optional(),
    adminEmail: z.string().trim().toLowerCase().email("E-mail do admin inválido.").optional(),
    adminName: z.string().trim().min(2, "Informe o nome do admin.").max(80).optional(),
  })
  .refine((v) => (v.adminEmail === undefined) === (v.adminName === undefined), {
    message: "Para indicar o admin, preencha nome e e-mail.",
  });

const opt = (v: FormDataEntryValue | null): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

export async function createOrganizationAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  try {
    const user = await getCurrentUser();
    if (!user.isPlatformAdmin) throw new AccessError(403, "Somente administradores da plataforma criam organizações.");

    const input = schema.parse({
      name: formData.get("name"),
      slug: opt(formData.get("slug")),
      adminEmail: opt(formData.get("adminEmail")),
      adminName: opt(formData.get("adminName")),
    });
    const slug = input.slug ?? slugify(input.name);
    if (!isValidSlug(slug)) {
      return { ok: false, message: `Endereço "${slug}" inválido ou reservado. Use letras minúsculas, números e hífen.` };
    }

    await createOrganization({
      name: input.name,
      slug,
      admin: input.adminEmail && input.adminName ? { email: input.adminEmail, name: input.adminName } : null,
    });
    revalidatePath("/");
    return { ok: true, message: `Organização criada: /${slug}` };
  } catch (err) {
    if (err instanceof DuplicateOrgSlugError) return { ok: false, message: `Já existe uma organização em /${err.message}.` };
    if (err instanceof z.ZodError) return { ok: false, message: err.issues[0]?.message ?? "Dados inválidos." };
    if (err instanceof AccessError) return { ok: false, message: err.message };
    console.error("[platform] create organization failed", err);
    return { ok: false, message: "Algo deu errado. Tente novamente." };
  }
}

const deleteSchema = z.object({
  orgId: z.string().uuid("Organização inválida."),
  confirmName: z.string().trim().max(120),
});

/**
 * Deletes an organization for good: its database rows (cascade) and its folder in the storage
 * (orgs/<slug>/). Platform administrators only, and only after typing the organization's name.
 */
export async function deleteOrganizationAction(_prev: PlatformFormState, formData: FormData): Promise<PlatformFormState> {
  try {
    const user = await getCurrentUser();
    if (!user.isPlatformAdmin) throw new AccessError(403, "Somente administradores da plataforma excluem organizações.");
    const input = deleteSchema.parse({ orgId: formData.get("orgId"), confirmName: formData.get("confirmName") ?? "" });

    const org = await getOrganizationById(input.orgId);
    if (!org) return { ok: false, message: "Esta organização não existe mais." };
    if (input.confirmName !== org.name.trim()) {
      return { ok: false, message: `Digite exatamente "${org.name}" para confirmar.` };
    }

    const deleted = await deleteOrganization(input.orgId);
    if (!deleted) return { ok: false, message: "Esta organização não existe mais." };
    console.info(`[platform] organization /${deleted.slug} deleted by ${user.id}`);
    revalidatePath("/");

    try {
      await storage.removeFolder(orgFolder(deleted.slug));
    } catch (err) {
      console.error(`[platform] organization /${deleted.slug} deleted, but its files could not be removed`, err);
      return { ok: true, message: `${deleted.name} foi excluída, mas alguns arquivos ficaram no armazenamento (orgs/${deleted.slug}/).` };
    }
    return { ok: true, message: `${deleted.name} foi excluída.` };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, message: err.issues[0]?.message ?? "Dados inválidos." };
    if (err instanceof AccessError) return { ok: false, message: err.message };
    console.error("[platform] delete organization failed", err);
    return { ok: false, message: "Não foi possível excluir. Tente novamente." };
  }
}
