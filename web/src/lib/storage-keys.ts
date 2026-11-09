/**
 * Storage key layout — one folder per organization, named by its address (slug):
 *
 *   orgs/<slug>/datasets/<dashboard>/v<n>/<table>.<rand>.parquet   published/draft data
 *   orgs/<slug>/uploads/<dashboard>/<uuid>.<csv|parquet>          raw file, deleted after ingest
 *   orgs/<slug>/branding/<uuid>.<ext>                             logos
 *   orgs/<slug>/clientes/<cliente>/…                              files of one client (folder follows its address)
 *   <espaço>/fiscal/<molde>/<cnpj>/<aaaa-mm>/<documento>.<rand>.<txt|xml>
 *                                                                 raw fiscal files (SPED, NF-e), kept; <espaço> is
 *                                                                 the client's folder or the organization's
 *
 * Organization slugs never change after creation; client slugs can (renaming moves the client's folder). Older rows may still hold keys in the
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

/** Whether `key` is a raw fiscal upload (.txt / .xml) this app issued for that organization's dashboard. */
export function isIssuedFiscalUploadKey(key: string, orgSlug: string, instanceId: string): boolean {
  const prefix = `${orgFolder(orgSlug)}uploads/${instanceId}/`;
  return key.startsWith(prefix) && new RegExp(`^${UUID}\\.(txt|xml)$`).test(key.slice(prefix.length));
}

const TEMPLATE_ID = /^[a-z0-9-]{1,60}$/;
const DOCUMENT_ID = /^[a-z0-9-]{1,60}$/;
const TAX_ID = /^\d{11,14}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Sub-folder of the organization that holds one folder per client. */
export const CLIENTS_DIR = "clientes";

/** "orgs/<slug>/clientes/<cliente>/" — a client's files, named by its address (moved when the address changes). */
export function clientFolder(orgSlug: string, clientSlug: string): string {
  if (!SLUG.test(clientSlug)) throw new StorageKeyError(`invalid client slug: ${clientSlug}`);
  return `${orgFolder(orgSlug)}${CLIENTS_DIR}/${clientSlug}/`;
}

/** Folder of a space: the client's folder, or the organization's own folder when there is no client. */
export function spaceFolder(orgSlug: string, clientSlug: string | null): string {
  return clientSlug ? clientFolder(orgSlug, clientSlug) : orgFolder(orgSlug);
}

/** "<espaço>/fiscal/<molde>/" — raw fiscal files of one dashboard model in one space. */
export function fiscalFolder(orgSlug: string, clientSlug: string | null, templateId: string): string {
  if (!TEMPLATE_ID.test(templateId)) throw new StorageKeyError("invalid fiscal folder");
  return `${spaceFolder(orgSlug, clientSlug)}fiscal/${templateId}/`;
}

/** Extensions people may store from the data connector (data, fiscal files and documents). */
export const STORABLE_EXTENSIONS = [
  "parquet", "csv", "txt", "xml", "json", "zip", "xlsx", "xls", "pdf", "pbix",
] as const;

/**
 * A file name safe as the last part of a key: accents removed, anything else than letters, digits,
 * dot, dash and underscore becomes "-". Returns null for an extension that may not be stored.
 */
export function storableFileName(original: string): string | null {
  const plain = original.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const dot = plain.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = plain.slice(dot + 1).toLowerCase();
  if (!(STORABLE_EXTENSIONS as readonly string[]).includes(ext)) return null;
  const base = plain.slice(0, dot).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 120) || "arquivo";
  return `${base}.${ext}`;
}

/** A raw fiscal file inside its company (CNPJ/CPF) and period folders, with a fresh suffix (keys are immutable). */
export function fiscalFileKey(folder: string, taxId: string, period: string, documentId: string, ext: "txt" | "xml"): string {
  if (!TAX_ID.test(taxId) || !PERIOD.test(period) || !DOCUMENT_ID.test(documentId)) {
    throw new StorageKeyError("invalid fiscal file");
  }
  return `${folder}${taxId}/${period}/${documentId}.${rand8()}.${ext}`;
}

/** The document a stored fiscal file holds (its name up to the random suffix). */
export function fiscalDocumentId(fileName: string): string {
  return fileName.replace(/\.[0-9a-f]{8}\.(txt|xml)$/, "");
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
