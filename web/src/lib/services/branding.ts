import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { OrgRef } from "../access";
import { setSpaceLogo } from "../data/branding";
import { storage } from "../storage";
import { isOrgLogoKey } from "../storage-keys";
import { checkLogo, LOGO_EXT } from "../theme/logo";

export class LogoError extends Error {}

type LogoOrg = Pick<OrgRef, "id" | "slug">;

/** Only this organization's logos may be deleted (keys, or legacy absolute paths in _branding/<org>/). */
function isOwnLogo(stored: string, org: LogoOrg): boolean {
  if (isOrgLogoKey(stored, org)) return true;
  return path.isAbsolute(stored) && stored.includes(`${path.sep}_branding${path.sep}${org.id}${path.sep}`);
}

/** Validates, stores and activates a new logo; removes the file it replaced. */
export async function replaceLogo(org: LogoOrg, clientId: string | null, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkLogo(bytes);
  if (!check.ok) throw new LogoError(check.error);

  const id = randomUUID();
  const key = storage.brandingKey(org.slug, id, LOGO_EXT[check.mime]);
  await storage.putBytes(key, bytes, check.mime);

  try {
    const previous = await setSpaceLogo(org.id, clientId, { key: id, path: key, mime: check.mime });
    if (previous && isOwnLogo(previous, org)) await storage.remove([previous]);
  } catch (err) {
    await storage.remove([key]);
    throw err;
  }
}

export async function removeLogo(org: LogoOrg, clientId: string | null): Promise<void> {
  const previous = await setSpaceLogo(org.id, clientId, null);
  if (previous && isOwnLogo(previous, org)) await storage.remove([previous]);
}
