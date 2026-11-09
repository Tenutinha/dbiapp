import "server-only";
import { randomUUID } from "node:crypto";
import { AvatarUnavailableError, setUserAvatar } from "../data/users";
import { storage } from "../storage";
import { isUserAvatarKey, userAvatarKey } from "../storage-keys";
import { checkLogo, LOGO_EXT } from "../theme/logo";

/** A message the profile form can show as is. */
export class AvatarError extends Error {}

const UNAVAILABLE = "Ainda não dá para salvar avatar: o banco precisa da migração 012.";

/** Validates (PNG/JPEG/WebP by content, up to 1 MB), stores and activates a new avatar; removes the old file. */
export async function replaceAvatar(userId: string, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkLogo(bytes);
  if (!check.ok) throw new AvatarError(check.error);

  const id = randomUUID();
  const key = userAvatarKey(userId, id, LOGO_EXT[check.mime]);
  await storage.putBytes(key, bytes, check.mime);
  try {
    const previous = await setUserAvatar(userId, { key: id, path: key, mime: check.mime });
    if (previous && isUserAvatarKey(previous, userId)) await storage.remove([previous]);
  } catch (err) {
    await storage.remove([key]);
    if (err instanceof AvatarUnavailableError) throw new AvatarError(UNAVAILABLE);
    throw err;
  }
}

/** Back to initials; the stored file is deleted. */
export async function removeAvatar(userId: string): Promise<void> {
  try {
    const previous = await setUserAvatar(userId, null);
    if (previous && isUserAvatarKey(previous, userId)) await storage.remove([previous]);
  } catch (err) {
    if (err instanceof AvatarUnavailableError) throw new AvatarError(UNAVAILABLE);
    throw err;
  }
}
