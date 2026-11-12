/**
 * What a stored file is and what to do with it (pure; client and server). The server reads a file once
 * and keeps its *facts* (layout, fiscal identity or columns); the *verdict* (ready, needs treatment…) is
 * worked out on every view against the space's current dashboards, so it follows them as they change.
 */
import { normalizeName } from "./ingest/contract";
import { clientSlugOf, CLIENTS_DIR, joinPath, parentOf } from "./storage-explorer";
import type { TemplateTable } from "./templates/schema";

/** What was read from the file (kept in the database; `v` versions the shape). */
export type FileFacts =
  | {
      v: 1;
      kind: "fiscal";
      /** Fiscal template this file feeds (efd-contribuicoes, efd-icms-ipi, ecd, nfe). */
      templateId: string;
      title: string;
      cnpj: string;
      /** "YYYY-MM". */
      periodo: string;
      documentId: string;
      label: string;
    }
  | { v: 1; kind: "table"; format: "csv" | "parquet"; columns: string[] }
  | { v: 1; kind: "unknown"; format: string }
  | { v: 1; kind: "document" }
  /** Not read on purpose (e.g. a big Parquet: its schema sits at the end of the file). */
  | { v: 1; kind: "deferred"; format: string };

export type FileStatus = "ready" | "treatment" | "unknown" | "document" | "deferred";

export interface Verdict {
  status: FileStatus;
  /** What the file is, for the "Layout" column. */
  layout: string;
  /** One line for the "Situação" column (the badge shows the status). */
  detail: string;
  /** Tables this file can feed as it is (table files). */
  readyFor?: { dashboard: string; table: string }[];
  /** Best table it almost fits and the required columns it lacks (table files that fit none). */
  closest?: { dashboard: string; table: string; missing: string[] };
  /** Dashboards of the space whose "Montar tabelas" reads this fiscal file. */
  buildIn?: string[];
  /** Fiscal file already in its standard folder (fiscal/<molde>/<cnpj>/<período>). */
  inStandard?: boolean;
}

/** A dashboard of the space, with its contract tables (to tell which files are ready for it). */
export interface SpaceDashboard {
  name: string;
  templateId: string;
  tables: readonly TemplateTable[];
}

// ---------- reading a CSV header ----------

const SEPARATORS = [",", ";", "\t", "|"] as const;

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/** First line of a quoted-aware CSV: where the line ends outside quotes. */
function firstLine(text: string): string {
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) return text.slice(0, i);
  }
  return text;
}

/** Column names of a CSV from its first bytes (separator , ; tab or |, quotes, BOM). [] when it is not text. */
export function parseCsvHeader(bytes: Uint8Array): string[] {
  if (bytes.length === 0 || bytes.subarray(0, 512).includes(0)) return [];
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  const line = firstLine(text);
  if (line.trim() === "") return [];
  const best = SEPARATORS.map((sep) => ({ sep, cells: splitLine(line, sep) })).sort((a, b) => b.cells.length - a.cells.length)[0];
  return best.cells.filter((c) => c !== "");
}

// ---------- the verdict ----------

const taxId = (d: string): string =>
  d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : d;

const month = (p: string): string => `${p.slice(5, 7)}/${p.slice(0, 4)}`;

/** The space folder a path belongs to: clientes/<cliente>, or "" for the organization's own files. */
export function spaceRoot(path: string): string {
  const slug = clientSlugOf(path);
  return slug ? `${CLIENTS_DIR}/${slug}` : "";
}

/** Standard folder of a fiscal file in the space of `path`: <espaço>/fiscal/<molde>/<cnpj>/<período>. */
export function fiscalStandardFolder(path: string, templateId: string, cnpj: string, periodo: string): string {
  return joinPath(spaceRoot(path), `fiscal/${templateId}/${cnpj}/${periodo}`);
}

function judgeTable(columns: readonly string[], format: string, space: readonly SpaceDashboard[]): Verdict {
  const have = new Set(columns.map(normalizeName));
  const layout = `${format.toUpperCase()} · ${columns.length} ${columns.length === 1 ? "coluna" : "colunas"}`;
  // Headers that collide once normalized ("Código" and "codigo") are refused by the engate (matchColumns).
  const seen = new Map<string, string[]>();
  for (const c of columns) seen.set(normalizeName(c), [...(seen.get(normalizeName(c)) ?? []), c]);
  const repeated = [...seen.values()].filter((names) => names.length > 1).flat();
  if (repeated.length > 0) {
    return { status: "treatment", layout, detail: `Colunas repetidas: ${repeated.join(", ")}.` };
  }
  const fits = space.flatMap((d) =>
    d.tables.map((t) => {
      const required = t.columns.filter((c) => c.required).map((c) => c.name);
      const missing = required.filter((c) => !have.has(c));
      const hits = t.columns.filter((c) => have.has(c.name)).length;
      return { dashboard: d.name, table: t.name, missing, hits };
    }),
  );
  const ready = fits.filter((f) => f.missing.length === 0 && f.hits > 0);
  if (ready.length > 0) {
    const readyFor = ready.map(({ dashboard, table }) => ({ dashboard, table }));
    return { status: "ready", layout, readyFor, detail: `Pronto para ${readyFor.map((r) => `${r.dashboard} › ${r.table}`).join(", ")}` };
  }
  const closest = [...fits].sort((a, b) => b.hits - a.hits || a.missing.length - b.missing.length)[0];
  if (!closest || closest.hits === 0) {
    return { status: "treatment", layout, detail: space.length ? "Colunas não batem com nenhuma tabela dos dashboards deste espaço." : "Nenhum dashboard neste espaço para comparar." };
  }
  return {
    status: "treatment",
    layout,
    closest: { dashboard: closest.dashboard, table: closest.table, missing: closest.missing },
    detail: `Mais próximo de ${closest.dashboard} › ${closest.table}; faltam ${closest.missing.join(", ")}.`,
  };
}

/** What a file is and what to do with it, given the dashboards of its space. */
export function judge(facts: FileFacts, path: string, space: readonly SpaceDashboard[]): Verdict {
  switch (facts.kind) {
    case "fiscal": {
      const buildIn = space.filter((d) => d.templateId === facts.templateId).map((d) => d.name);
      const inStandard = parentOf(path) === fiscalStandardFolder(path, facts.templateId, facts.cnpj, facts.periodo);
      const where = buildIn.length ? `Montar tabelas em ${buildIn.join(", ")}.` : `Nenhum dashboard ${facts.title} neste espaço.`;
      return {
        status: "treatment",
        layout: `${facts.title} · ${taxId(facts.cnpj)} · ${month(facts.periodo)}`,
        detail: inStandard ? where : `${where} Fora da pasta padrão (use "Organizar pasta").`,
        buildIn,
        inStandard,
      };
    }
    case "table":
      return judgeTable(facts.columns, facts.format, space);
    case "document":
      return { status: "document", layout: "Documento", detail: "Guardado como documento; não alimenta dashboards." };
    case "deferred":
      return { status: "deferred", layout: facts.format.toUpperCase(), detail: "Colunas conferidas ao escolher o arquivo no engate." };
    case "unknown":
      return { status: "unknown", layout: facts.format.toUpperCase(), detail: "Layout não reconhecido." };
  }
}

/** Was the file changed since it was analysed (size or modification date)? No record = never analysed. */
export function isStale(
  stored: { sizeBytes: number; updatedAt: string | null } | undefined,
  current: { sizeBytes: number; updatedAt: string | null },
): boolean {
  return !stored || stored.sizeBytes !== current.sizeBytes || stored.updatedAt !== current.updatedAt;
}

// ---------- "Organizar pasta": copies of the same document ----------

/** A loose fiscal file about to be filed. */
export interface CopyCandidate {
  path: string;
  /** Standard destination folder. */
  to: string;
  /** What makes it "the same document" there (SPED: one per layout, company and month). */
  documentId: string;
  updatedAt: string | null;
}

/** What to do with one candidate when other copies of its document exist (loose or already filed). */
export interface CopyDecision {
  /** Ticked by default in the preview: it is the newest copy of its document. */
  suggested: boolean;
  /** Filing it deletes the copy already in the destination. */
  replaces: boolean;
  /** Why it is not suggested. */
  note?: string;
}

/** Former name of a filed fiscal file: <documento>.<8 hex>.<txt|xml>. */
const FORMER_NAME = /^(.+)\.[0-9a-f]{8}\.(txt|xml)$/;

/** A NF-e access key (44 digits): unlike a SPED, many documents share one period folder. */
const isAccessKey = (documentId: string): boolean => /^\d{44}$/.test(documentId);

/**
 * Whether a file already in the standard period folder holds the same document as a new one, so the
 * new one replaces it. A SPED is one per period of its model: any other file of the same type is an
 * older copy (re-sent, corrected), whatever its name. A NF-e is found by its access key in the name.
 * Files still named the former way (<documento>.<rand>.<ext>) are recognized by that name.
 */
export function isSameFiscalDocument(existingName: string, documentId: string, ext: "txt" | "xml"): boolean {
  if (FORMER_NAME.exec(existingName)?.[1] === documentId) return true;
  if (isAccessKey(documentId)) return existingName.includes(documentId);
  return existingName.toLowerCase().endsWith(`.${ext}`);
}

const newer = (a: string | null, b: string | null): boolean => (a ?? "") > (b ?? "");
const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * Filing keeps one copy per document in its folder (a new one replaces the old). So among the loose copies
 * of a document and the one already filed, only the newest is suggested; the others are left unticked
 * with the reason, and never two copies of the same document are filed in one go.
 */
export function resolveCopies(
  moves: readonly CopyCandidate[],
  filed: ReadonlyMap<string, readonly { name: string; updatedAt: string | null }[]>,
): CopyDecision[] {
  const groupKey = (m: { to: string; documentId: string }): string => `${m.to}\u0000${m.documentId}`;
  const newestLoose = new Map<string, CopyCandidate>();
  for (const m of moves) {
    const best = newestLoose.get(groupKey(m));
    if (!best || newer(m.updatedAt, best.updatedAt)) newestLoose.set(groupKey(m), m);
  }
  return moves.map((m) => {
    const ext = m.path.toLowerCase().endsWith(".xml") ? "xml" : "txt";
    const existing = (filed.get(m.to) ?? []).filter((f) => isSameFiscalDocument(f.name, m.documentId, ext));
    const replaces = existing.length > 0;
    const best = newestLoose.get(groupKey(m))!;
    if (best !== m) return { suggested: false, replaces, note: `Há uma cópia mais nova deste documento: ${baseName(best.path)}.` };
    if (existing.some((f) => newer(f.updatedAt, m.updatedAt))) {
      return { suggested: false, replaces, note: "A cópia já arquivada é mais nova; organizar esta a substituiria." };
    }
    return { suggested: true, replaces };
  });
}
