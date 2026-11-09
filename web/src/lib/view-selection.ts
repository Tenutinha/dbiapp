import "server-only";
import { cookies } from "next/headers";

/**
 * The viewing screen keeps one fixed address per space (`/<org>` or `/<org>/<client>`). Which
 * dashboard is open there is remembered in a cookie per space instead of in the URL.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/** Space id: the client's id inside a client space, else the organization's. */
export const viewCookieName = (spaceId: string): string => `dbi_view_${spaceId}`;

export const viewCookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: MAX_AGE_SECONDS,
};

/** The fixed address of a space's viewing screen. */
export function spacePath(orgSlug: string, clientSlug: string | null): string {
  return clientSlug ? `/${orgSlug}/${clientSlug}` : `/${orgSlug}`;
}

/** Dashboard last opened in this space, if any (validated shape only; access is checked by the caller). */
export async function readViewSelection(spaceId: string): Promise<string | null> {
  const value = (await cookies()).get(viewCookieName(spaceId))?.value;
  return value && UUID.test(value) ? value : null;
}

/** Remembers the open dashboard. Only callable from server actions and route handlers. */
export async function writeViewSelection(spaceId: string, instanceId: string): Promise<void> {
  (await cookies()).set(viewCookieName(spaceId), instanceId, viewCookieOptions);
}
