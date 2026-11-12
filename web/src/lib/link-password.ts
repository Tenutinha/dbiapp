/**
 * Password of a space's public link (/l/<token>): only a salted scrypt hash is kept, and a reader who
 * typed it right gets a signed pass in a cookie of that link alone, so the password is asked once per
 * browser (for PASS_TTL_MS), not on every page or filter.
 */
import "server-only";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export const MIN_PASSWORD = 6;
export const MAX_PASSWORD = 100;
/** How long a right password opens the link in that browser. */
export const PASS_TTL_MS = 12 * 60 * 60 * 1000;
/** Wrong passwords in a row before the link is locked for LOCK_MS. */
export const MAX_FAILURES = 10;
export const LOCK_MS = 15 * 60 * 1000;

const KEY_LENGTH = 32;

/** "scrypt$<salt>$<hash>", base64url. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const given = scryptSync(password, Buffer.from(salt, "base64url"), expected.length);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Cookie of one link (its id, so passes of different links never mix). */
export const passCookieName = (linkId: string): string => `dbi-link-${linkId.replace(/-/g, "").slice(0, 16)}`;

function key(): Buffer {
  return createHmac("sha256", env.DATABASE_URL).update("dbi:space-link-pass:v1").digest();
}

/** The signature ties the pass to the link and to its current password: a new password voids old passes. */
const sign = (linkId: string, expires: number, passwordHash: string): string =>
  createHmac("sha256", key()).update(`${linkId}:${expires}:${passwordHash}`).digest("base64url");

export function issuePass(linkId: string, passwordHash: string, now: number = Date.now()): string {
  const expires = now + PASS_TTL_MS;
  return `${expires}.${sign(linkId, expires, passwordHash)}`;
}

export function isValidPass(pass: string | undefined, linkId: string, passwordHash: string, now: number = Date.now()): boolean {
  if (!pass || pass.length > 200) return false;
  const [exp, signature, ...rest] = pass.split(".");
  const expires = Number(exp);
  if (!signature || rest.length > 0 || !Number.isSafeInteger(expires) || expires < now) return false;
  const expected = Buffer.from(sign(linkId, expires, passwordHash));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
