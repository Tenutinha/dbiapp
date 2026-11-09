"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccessError, getCurrentUser } from "@/lib/auth";
import { createOrganization, DuplicateOrgSlugError } from "@/lib/data/platform";
import { isValidSlug, slugify } from "@/lib/permissions";

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
