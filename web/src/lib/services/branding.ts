import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setSpaceLogo } from "../data/branding";
import { storage } from "../storage";
import { checkLogo, LOGO_EXT } from "../theme/logo";

export class LogoError extends Error {}

/** Only this organization's logos may be deleted (keys, or legacy absolute paths in _branding/<org>/). */
function isOwnLogo(stored: string, orgId: string): boolean {
  if (stored.startsWith(`branding/${orgId}/`)) return true;
  return path.isAbsolute(stored) && stored.includes(`${path.sep}_branding${path.sep}${orgId}${path.sep}`);
}

/** Validates, stores and activates a new logo; removes the file it replaced. */
export async function replaceLogo(orgId: string, clientId: string | null, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkLogo(bytes);
  if (!check.ok) throw new LogoError(check.error);

  const id = randomUUID();
  const key = storage.brandingKey(orgId, id, LOGO_EXT[check.mime]);
  await storage.putBytes(key, bytes, check.mime);

  try {
    const previous = await setSpaceLogo(orgId, clientId, { key: id, path: key, mime: check.mime });
    if (previous && isOwnLogo(previous, orgId)) await storage.remove([previous]);
  } catch (err) {
    await storage.remove([key]);
    throw err;
  }
}

export async function removeLogo(orgId: string, clientId: string | null): Promise<void> {
  const previous = await setSpaceLogo(orgId, clientId, null);
  if (previous && isOwnLogo(previous, orgId)) await storage.remove([previous]);
}
