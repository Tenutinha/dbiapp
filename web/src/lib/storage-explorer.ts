/**
 * Pure rules of the organization's file explorer (safe in client and server code). Paths are always
 * relative to the organization's folder (orgs/<slug>/), "/"-separated, without leading/trailing "/".
 */
import { namesIn } from "./ingest/joined-name";

/** Folder that holds one sub-folder per client (orgs/<org>/clientes/<cliente>/). */
export const CLIENTS_DIR = "clientes";
/** Folder of the dashboards' definitive Parquet files, in each space (see storage-keys.ts). */
export const DASHBOARDS_DIR = "dashboards";

export type FileKindId = "parquet" | "csv" | "text" | "xml" | "json" | "zip" | "excel" | "pdf" | "pbix" | "other";

export interface FileKind {
  kind: FileKindId;
  label: string;
  /** Can feed a dashboard table (.parquet, .csv, .txt). */
  data: boolean;
}

const KINDS: Record<string, FileKind> = {
  parquet: { kind: "parquet", label: "Parquet", data: true },
  csv: { kind: "csv", label: "CSV", data: true },
  txt: { kind: "text", label: "Texto (SPED)", data: true },
  xml: { kind: "xml", label: "XML", data: false },
  json: { kind: "json", label: "JSON", data: false },
  zip: { kind: "zip", label: "ZIP", data: false },
  xlsx: { kind: "excel", label: "Excel", data: false },
  xls: { kind: "excel", label: "Excel", data: false },
  pdf: { kind: "pdf", label: "PDF", data: false },
  pbix: { kind: "pbix", label: "Power BI", data: false },
};

const OTHER: FileKind = { kind: "other", label: "Arquivo", data: false };

export function fileKind(name: string): FileKind {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? OTHER : KINDS[name.slice(dot + 1).toLowerCase()] ?? OTHER;
}

/** One item of a folder as the explorer shows it. */
export interface ExplorerEntry {
  name: string;
  /** Relative to the organization's folder. */
  path: string;
  folder: boolean;
  sizeBytes: number;
  /** ISO date, or null for folders / unknown. */
  updatedAt: string | null;
}

export function joinPath(folder: string, name: string): string {
  const base = folder.replace(/^\/+|\/+$/g, "");
  return base ? `${base}/${name}` : name;
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** The client a path belongs to: clientes/<slug>/… → slug. */
export function clientSlugOf(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  return parts[0] === CLIENTS_DIR && parts[1] ? parts[1] : null;
}

/**
 * Folders the platform writes itself at the organization root (published data, pending uploads, logos):
 * hidden from the explorer and never touched by it (see storage-keys.ts for the layout).
 */
export const SYSTEM_DIRS: readonly string[] = ["datasets", "uploads", "branding"];

const SYSTEM_PROBLEM = "Esta pasta é da plataforma e não pode ser alterada.";

export function isSystemPath(path: string): boolean {
  const first = path.split("/").filter(Boolean)[0];
  return first !== undefined && SYSTEM_DIRS.includes(first);
}

/**
 * The dashboards' definitive data: <espaço>/dashboards/… (the organization's or a client's). Shown in the
 * explorer, but only the platform writes there — publishing a dashboard replaces it.
 */
export function isDashboardsPath(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  return parts[0] === DASHBOARDS_DIR || (parts[0] === CLIENTS_DIR && parts[2] === DASHBOARDS_DIR);
}

const DASHBOARDS_PROBLEM = "Esta pasta guarda os dados publicados dos dashboards: só muda ao publicar.";

/** Not the user's to change: the platform's hidden folders and the dashboards' data. */
export function isReadOnlyPath(path: string): boolean {
  return isSystemPath(path) || isDashboardsPath(path);
}

/** The organization root, "clientes", each client's own folder and the platform's folders are not the user's to change. */
export function isProtectedFolder(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  return parts.length === 0 || (parts[0] === CLIENTS_DIR && parts.length <= 2) || isReadOnlyPath(path);
}

function clean(text: string, max: number): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, max);
}

/** A new folder name made safe (accents and spaces become simple characters), or null if nothing is left. */
export function safeFolderName(name: string): string | null {
  const safe = clean(name, 80);
  return safe === "" ? null : safe;
}

/** A dropped folder's sub-path with every level made safe (empty levels such as ".." are dropped). */
export function safeDroppedDir(dir: string): string {
  return dir.split("/").map((p) => safeFolderName(p)).filter((p): p is string => p !== null).join("/");
}

/**
 * Why files or folders cannot be put in `folder`, or null when they can: "clientes" only holds the
 * clients' own folders, and clientes/<slug> must be a real client (or it would look like one forever).
 */
export function targetProblem(folder: string, clientSlugs: ReadonlySet<string>): string | null {
  if (isSystemPath(folder)) return SYSTEM_PROBLEM;
  if (isDashboardsPath(folder)) return DASHBOARDS_PROBLEM;
  const parts = folder.split("/").filter(Boolean);
  if (parts[0] !== CLIENTS_DIR) return null;
  if (parts.length === 1) return "Dentro de “clientes” só ficam as pastas dos clientes. Escolha a pasta de um cliente.";
  return clientSlugs.has(parts[1]) ? null : `“${parts[1]}” não é um cliente desta organização.`;
}

/** New name for a file: cleaned, always keeping the original extension (the type never changes). */
export function renamedFileName(original: string, wanted: string): string | null {
  const dot = original.lastIndexOf(".");
  const ext = dot > 0 ? original.slice(dot) : "";
  const typed = wanted.trim();
  const base = ext && typed.toLowerCase().endsWith(ext.toLowerCase()) ? typed.slice(0, -ext.length) : typed;
  const safe = clean(base, 120);
  return safe === "" ? null : `${safe}${ext.toLowerCase()}`;
}

/** Why an item cannot go to a folder, or null when it can. */
export function canMoveTo(item: { path: string; folder: boolean }, target: string): string | null {
  if (isSystemPath(item.path) || isSystemPath(target)) return SYSTEM_PROBLEM;
  if (isDashboardsPath(item.path) || isDashboardsPath(target)) return DASHBOARDS_PROBLEM;
  if (item.folder && isProtectedFolder(item.path)) return "Pastas de cliente não podem ser movidas.";
  if (parentOf(item.path) === target) return "Já está nessa pasta.";
  if (item.folder && (target === item.path || target.startsWith(`${item.path}/`))) {
    return "Uma pasta não pode ir para dentro dela mesma.";
  }
  return null;
}

/** A dashboard that engaged a file (by its stored name; several names when a table is fed by several files) in one space. */
export interface FileUse {
  file: string;
  /** Client of the dashboard, or null for the organization's own dashboards. */
  clientSlug: string | null;
  dashboard: string;
  state: "active" | "draft";
}

/** Dashboards of the folder's space that engaged a file with this name. */
export function usageFor(uses: readonly FileUse[], folder: string, name: string): { dashboard: string; state: FileUse["state"] }[] {
  const client = clientSlugOf(folder);
  return uses
    .filter((u) => u.clientSlug === client && namesIn(u.file).includes(name))
    .map((u) => ({ dashboard: u.dashboard, state: u.state }));
}

export type SortKey = "name" | "type" | "size" | "updated";
export type SortDir = "asc" | "desc";

/** Folders first (by name), then files by the chosen column. Returns a new array. */
export function sortEntries<T extends ExplorerEntry>(entries: readonly T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T): number => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  const compare = (a: T, b: T): number => {
    if (key === "size") return a.sizeBytes - b.sizeBytes;
    if (key === "updated") return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
    if (key === "type") return fileKind(a.name).label.localeCompare(fileKind(b.name).label) || byName(a, b);
    return byName(a, b);
  };
  return [...entries].sort((a, b) => {
    if (a.folder !== b.folder) return a.folder ? -1 : 1;
    if (a.folder) return byName(a, b);
    return sign * compare(a, b) || byName(a, b);
  });
}

/** An item as the explorer shows it: the storage entry plus whose it is and who used it. */
export interface ExplorerItem extends ExplorerEntry {
  /** Client the item belongs to (by its folder), or null for the organization's own files. */
  client: string | null;
  /** Dashboards of that space that engaged a file with this name. */
  usedIn: { dashboard: string; state: FileUse["state"] }[];
}

/** What the explorer needs once per organization (not per folder): clients and file uses. */
export interface ExplorerMeta {
  clients: { slug: string; name: string }[];
  uses: FileUse[];
}

/** Adds the client name and "Usado em" to a folder's entries (meta may still be loading: slugs, no uses). */
export function decorate(entries: readonly ExplorerEntry[], folder: string, meta: ExplorerMeta | null): ExplorerItem[] {
  const names = new Map((meta?.clients ?? []).map((c) => [c.slug, c.name]));
  const clientOf = (path: string): string | null => {
    const slug = clientSlugOf(path);
    return slug ? names.get(slug) ?? slug : null;
  };
  return entries.map((e) => ({
    ...e,
    client: clientOf(e.folder ? e.path : folder),
    usedIn: e.folder || !meta ? [] : usageFor(meta.uses, folder, e.name),
  }));
}

/**
 * What a selection chooses in pick mode: the selected items, when every one of them is a file that can be
 * chosen — one at most unless several are allowed. A selection with a folder or a file that does not
 * serve chooses nothing, so it is never connected by half.
 */
export function pickableItems<T extends { folder: boolean }>(selected: readonly T[], accept: (item: T) => boolean, multiple: boolean): T[] {
  if (selected.length === 0 || (!multiple && selected.length > 1)) return [];
  return selected.every((i) => !i.folder && accept(i)) ? [...selected] : [];
}
