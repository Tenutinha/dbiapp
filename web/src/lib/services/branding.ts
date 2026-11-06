import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setSpaceLogo } from "../data/branding";
import { storage } from "../storage";
import { checkLogo, LOGO_EXT } from "../theme/logo";

export class LogoError extends Error {}

function isInsideBrandingDir(p: string, orgId: string): boolean {
  const dir = path.resolve(storage.root, "_branding", orgId) + path.sep;
  return path.resolve(p).startsWith(dir);
}

/** Validates, stores and activates a new logo; removes the file it replaced. */
export async function replaceLogo(orgId: string, clientId: string | null, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkLogo(bytes);
  if (!check.ok) throw new LogoError(check.error);

  const key = randomUUID();
  const target = path.join(storage.root, "_branding", orgId, `${key}.${LOGO_EXT[check.mime]}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);

  try {
    const previous = await setSpaceLogo(orgId, clientId, { key, path: target, mime: check.mime });
    if (previous && isInsideBrandingDir(previous, orgId)) await rm(previous, { force: true });
  } catch (err) {
    await rm(target, { force: true });
    throw err;
  }
}

export async function removeLogo(orgId: string, clientId: string | null): Promise<void> {
  const previous = await setSpaceLogo(orgId, clientId, null);
  if (previous && isInsideBrandingDir(previous, orgId)) await rm(previous, { force: true });
}
