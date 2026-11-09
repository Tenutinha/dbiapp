"use server";

import { revalidatePath } from "next/cache";
import { AccessError, getCurrentUser } from "@/lib/auth";
import { getUserProfile, type UserProfile } from "@/lib/data/users";
import { setOwnPassword } from "@/lib/password";
import { AvatarError, removeAvatar, replaceAvatar } from "@/lib/services/avatar";

export interface ProfileFormState {
  ok: boolean;
  message: string;
}

function failure(err: unknown, where: string): ProfileFormState {
  if (err instanceof AvatarError || err instanceof AccessError) return { ok: false, message: err.message };
  console.error(`[perfil] ${where} failed`, err);
  return { ok: false, message: "Algo deu errado. Tente novamente." };
}

/** "Meu perfil": the signed-in person's data and where they have access (only ever their own). */
export async function loadProfileAction(): Promise<{ ok: true; profile: UserProfile } | { ok: false; message: string }> {
  try {
    const user = await getCurrentUser();
    const profile = await getUserProfile(user.id);
    return profile ? { ok: true, profile } : { ok: false, message: "Perfil não encontrado." };
  } catch (err) {
    const f = failure(err, "load");
    return { ok: false, message: f.message };
  }
}

export async function uploadAvatarAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  try {
    const user = await getCurrentUser();
    const file = formData.get("avatar");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Escolha uma imagem." };
    await replaceAvatar(user.id, file);
    revalidatePath("/", "layout");
    return { ok: true, message: "Avatar atualizado." };
  } catch (err) {
    return failure(err, "avatar upload");
  }
}

export async function removeAvatarAction(): Promise<ProfileFormState> {
  try {
    const user = await getCurrentUser();
    await removeAvatar(user.id);
    revalidatePath("/", "layout");
    return { ok: true, message: "Avatar removido — voltamos às iniciais." };
  } catch (err) {
    return failure(err, "avatar remove");
  }
}

export async function changePasswordAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  try {
    await getCurrentUser();
    const result = await setOwnPassword(formData.get("password"), formData.get("confirm"));
    return result.ok ? { ok: true, message: "Senha trocada." } : { ok: false, message: result.message };
  } catch (err) {
    return failure(err, "password");
  }
}
