/**
 * Read-only browsing of an organization's storage folder (orgs/<slug>/…) in the administration.
 * Pure: turns the `?pasta=` sub-path into a bucket prefix that can never leave the folder.
 */
import { orgFolder, StorageKeyError } from "./storage-keys";

/** One folder name: letters, digits, dot, dash, underscore — and never "." or "..". */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export interface BrowseEntryFile {
  /** Full storage key. */
  key: string;
  name: string;
  sizeBytes: number;
  updatedAt: Date | null;
}

export interface FolderListing {
  /** Sub-folder names (no slashes). */
  folders: string[];
  files: BrowseEntryFile[];
  /** More entries than one page could show. */
  truncated: boolean;
}

function segments(subPath: string | undefined): string[] {
  const parts = (subPath ?? "").split("/").filter((p) => p !== "");
  for (const p of parts) {
    if (!SEGMENT.test(p)) throw new StorageKeyError(`invalid folder: ${p}`);
  }
  if ((subPath ?? "").includes("//")) throw new StorageKeyError("invalid folder path");
  return parts;
}

/** Bucket prefix for a sub-folder of the organization's folder (always ends with "/"). */
export function browsePrefix(orgSlug: string, subPath: string | undefined): string {
  const trimmed = (subPath ?? "").replace(/^\/+|\/+$/g, "");
  const parts = segments(trimmed);
  return orgFolder(orgSlug) + parts.map((p) => `${p}/`).join("");
}

/** A key as the administration shows it: relative to the organization's folder. */
export function relativeToOrg(orgSlug: string, key: string): string {
  const folder = orgFolder(orgSlug);
  return key.startsWith(folder) ? key.slice(folder.length) : key;
}

/** Breadcrumbs for a sub-path: one link per level. */
export function browseCrumbs(subPath: string): { label: string; path: string }[] {
  const parts = subPath.split("/").filter((p) => p !== "");
  return parts.map((label, i) => ({ label, path: parts.slice(0, i + 1).join("/") }));
}
