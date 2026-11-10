/**
 * Rules of a space's public link (anyone with it sees the space's published dashboards, read-only,
 * without signing in). Pure: client and server.
 */

/** Validity offered when the link is created. */
export const EXPIRY_CHOICES = [
  { id: "1", label: "1 dia" },
  { id: "7", label: "7 dias" },
  { id: "30", label: "30 dias" },
  { id: "never", label: "Sem expiração" },
] as const;

export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]["id"];

const DAY_MS = 86_400_000;

export function expiryDate(choice: ExpiryChoice, now = Date.now()): Date | null {
  return choice === "never" ? null : new Date(now + Number(choice) * DAY_MS);
}

export interface SpaceLinkRow {
  id: string;
  token: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export type LinkState = "active" | "expired" | "revoked";

export function linkState(link: Pick<SpaceLinkRow, "expiresAt" | "revokedAt">, now = Date.now()): LinkState {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now) return "expired";
  return "active";
}

/** The space's link in use: the newest one still valid, or null. */
export function activeLink<T extends SpaceLinkRow>(links: readonly T[], now = Date.now()): T | null {
  return [...links]
    .filter((l) => linkState(l, now) === "active")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
}

/**
 * Which dashboard the public page opens: the requested one only when it is in the space's published
 * summary (a link never opens anything else), else the first of the summary.
 */
export function chooseDashboard(publishedIds: readonly string[], requested: string | undefined): string | null {
  if (requested && publishedIds.includes(requested)) return requested;
  return publishedIds[0] ?? null;
}

/** Address of a public link (path; the page adds the host when copying). */
export const spaceLinkPath = (token: string): string => `/l/${token}`;

/** Query parameter of the open dashboard on the public page (filters use their own names). */
export const DASHBOARD_PARAM = "painel";
