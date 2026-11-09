/**
 * Storage key layout — one folder per organization, named by its address (slug):
 *
 *   orgs/<slug>/datasets/<dashboard>/v<n>/<table>.<rand>.parquet   published/draft data
 *   orgs/<slug>/uploads/<dashboard>/<uuid>.<csv|parquet>          raw file, deleted after ingest
 *   orgs/<slug>/branding/<uuid>.<ext>                             logos
 *
 * Slugs never change after an organization is created. Older rows may still hold keys in the
 * previous layout (datasets/…, incoming/…, branding/… at the root); those stay readable.
 */
import { randomUUID } from "node:crypto";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY = /^(orgs|datasets|incoming|branding|users)\/[A-Za-z0-9._/-]+$/;

export class StorageKeyError extends Error {}

export function isValidKey(key: string): boolean {
  return KEY.test(key) && !key.includes("..") && !key.includes("//");
}

export function assertKey(key: string): void {
  if (!isValidKey(key)) throw new StorageKeyError(`invalid storage key: ${key}`);
}

/** "orgs/<slug>/" — the organization's folder (trailing slash, as cloud consoles show folders). */
export function orgFolder(orgSlug: string): string {
  if (!SLUG.test(orgSlug)) throw new StorageKeyError(`invalid organization slug: ${orgSlug}`);
  return `orgs/${orgSlug}/`;
}

const rand8 = (): string => randomUUID().slice(0, 8);

export function datasetKey(orgSlug: string, instanceId: string, version: number, table: string): string {
  return `${orgFolder(orgSlug)}datasets/${instanceId}/v${version}/${table}.${rand8()}.parquet`;
}

export function uploadKey(orgSlug: string, instanceId: string, ext: string): string {
  return `${orgFolder(orgSlug)}uploads/${instanceId}/${randomUUID()}.${ext}`;
}

export function brandingKey(orgSlug: string, id: string, ext: string): string {
  return `${orgFolder(orgSlug)}branding/${id}.${ext}`;
}

/** Whether `key` is a raw-upload key this app issued for that organization's dashboard. */
export function isIssuedUploadKey(key: string, orgSlug: string, instanceId: string): boolean {
  const prefix = `${orgFolder(orgSlug)}uploads/${instanceId}/`;
  return key.startsWith(prefix) && new RegExp(`^${UUID}\\.(csv|parquet)$`).test(key.slice(prefix.length));
}

const UUID_ONLY = new RegExp(`^${UUID}$`);

/** "users/<user id>/avatar/<id>.<ext>" — a person's avatar, outside any organization's folder. */
export function userAvatarKey(userId: string, id: string, ext: string): string {
  if (!UUID_ONLY.test(userId) || !UUID_ONLY.test(id)) throw new StorageKeyError("invalid avatar key");
  return `users/${userId}/avatar/${id}.${ext}`;
}

/** Whether `key` is an avatar stored for this user (only those may be replaced or deleted). */
export function isUserAvatarKey(key: string, userId: string): boolean {
  return UUID_ONLY.test(userId) && key.startsWith(`users/${userId}/avatar/`) && isValidKey(key);
}

/** Whether `key` is a logo stored for this organization (current or previous layout). */
export function isOrgLogoKey(key: string, org: { id: string; slug: string }): boolean {
  return key.startsWith(`${orgFolder(org.slug)}branding/`) || key.startsWith(`branding/${org.id}/`);
}
