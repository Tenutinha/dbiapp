"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSpaceAction } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { saveSpaceColors } from "@/lib/data/branding";
import { LogoError, removeLogo, replaceLogo } from "@/lib/services/branding";
import { brandingInputSchema } from "@/lib/theme/theme";

export interface ThemeFormState {
  ok: boolean;
  message: string;
}

const slug = z.string().regex(/^[a-z0-9-]{1,40}$/);
const scopeSchema = z.object({ org: slug, client: slug.nullable() });
const orNull = (v: FormDataEntryValue | null): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function scopeFrom(formData: FormData) {
  return scopeSchema.parse({ org: formData.get("org"), client: orNull(formData.get("client")) });
}

function failure(err: unknown): ThemeFormState {
  if (err instanceof z.ZodError) return { ok: false, message: err.issues[0]?.message ?? "Dados inválidos." };
  if (err instanceof AccessError || err instanceof LogoError) return { ok: false, message: err.message };
  console.error("[branding] unexpected error", err);
  return { ok: false, message: "Algo deu errado. Tente novamente." };
}

export async function saveColorsAction(_prev: ThemeFormState, formData: FormData): Promise<ThemeFormState> {
  try {
    const scope = scopeFrom(formData);
    const { space } = await requireSpaceAction(scope.org, scope.client, "admin");
    const input = brandingInputSchema.parse({
      primaryColor: orNull(formData.get("primaryColor")),
      secondaryColor: orNull(formData.get("secondaryColor")),
      sidebarColor: orNull(formData.get("sidebarColor")),
      appearance: orNull(formData.get("appearance")),
    });
    await saveSpaceColors(space.orgId, space.clientId, input);
    revalidatePath(`/${scope.org}`, "layout");
    return { ok: true, message: "Cores salvas." };
  } catch (err) {
    return failure(err);
  }
}

export async function uploadLogoAction(_prev: ThemeFormState, formData: FormData): Promise<ThemeFormState> {
  try {
    const scope = scopeFrom(formData);
    const { ctx, space } = await requireSpaceAction(scope.org, scope.client, "admin");
    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Escolha um arquivo de imagem." };
    await replaceLogo(ctx.org, space.clientId, file);
    revalidatePath(`/${scope.org}`, "layout");
    return { ok: true, message: "Logo atualizado." };
  } catch (err) {
    return failure(err);
  }
}

export async function removeLogoAction(_prev: ThemeFormState, formData: FormData): Promise<ThemeFormState> {
  try {
    const scope = scopeFrom(formData);
    const { ctx, space } = await requireSpaceAction(scope.org, scope.client, "admin");
    await removeLogo(ctx.org, space.clientId);
    revalidatePath(`/${scope.org}`, "layout");
    return { ok: true, message: "Logo removido." };
  } catch (err) {
    return failure(err);
  }
}
