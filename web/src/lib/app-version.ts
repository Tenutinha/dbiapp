import { z } from "zod";

/**
 * Which build of DBI is running, so an open screen can tell when a newer one was published.
 *
 * A phone keeps an installed app (and a browser tab) alive in the background for days; reopening it
 * shows the same screen again without asking the server for anything. AppUpdater compares the version
 * the screen was built with against /api/version whenever the app comes back to the foreground.
 */
export const DEV_VERSION = "dev";
/** Where the browser asks which version is published. */
export const VERSION_ENDPOINT = "/api/version";
/** At most one check per minute, however often the person switches apps. */
export const UPDATE_CHECK_INTERVAL_MS = 60_000;

const MAX_VERSION_LENGTH = 200;
const versionResponseSchema = z.object({ version: z.string().min(1).max(MAX_VERSION_LENGTH) });

export type UpdateDecision = "reload" | "wait" | "none";

export interface UpdateState {
  /** Version this screen was rendered with. */
  current: string;
  /** Version the server answered with, or null when the answer could not be used. */
  latest: string | null;
  /** Version this tab already reloaded for, or null. */
  attempted: string | null;
  /** The person is in the middle of something a reload would throw away. */
  busy: boolean;
}

/** The deployment's id on Vercel (both exist at build time and at run time); "dev" anywhere else. */
export function resolveAppVersion(env: Readonly<Record<string, string | undefined>>): string {
  const candidates = [env.VERCEL_DEPLOYMENT_ID, env.VERCEL_GIT_COMMIT_SHA];
  return candidates.map((v) => v?.trim()).find((v) => v) ?? DEV_VERSION;
}

/** The version in /api/version's answer, or null when the answer is not what we expect. */
export function parseVersionResponse(body: unknown): string | null {
  const parsed = versionResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.version : null;
}

/**
 * What to do once the published version is known. A tab reloads at most once per published version:
 * if the reload still brings the old screen (a cache in between), it must not reload forever.
 */
export function decideUpdate({ current, latest, attempted, busy }: UpdateState): UpdateDecision {
  if (!latest || latest === current) return "none";
  if (current === DEV_VERSION || latest === DEV_VERSION) return "none";
  if (attempted === latest) return "none";
  return busy ? "wait" : "reload";
}

export function shouldCheckNow(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt === null || now - lastCheckAt >= UPDATE_CHECK_INTERVAL_MS;
}
