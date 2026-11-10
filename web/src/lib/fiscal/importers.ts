/**
 * Which templates accept raw fiscal files, and how each file is identified and read.
 * Pure: the service (services/fiscal.ts) does the storage and ingestion around it.
 *
 * Two shapes of import:
 *  - "sped": one big text file read line by line into a wide fact (every record, every field);
 *  - "documents": many small files (NF-e XML), each parsed whole into the template's tables.
 */
import { identifyNfe, parseNfe } from "./nfe";
import { dedupeBy, FiscalFileError, readSped, type Cell, type Row } from "./sped";
import { factColumns, SPED_KINDS, SpedReader, type SpedKind } from "./sped-kinds";

export type FiscalTables = Record<string, Row[]>;

/** Where a raw file goes: one folder per company (CNPJ) and period, and the file's own id inside it. */
export interface FiscalIdentity {
  cnpj: string;
  /** "YYYY-MM" — the folder of the period. */
  periodo: string;
  /**
   * What makes this file unique inside its period folder. A new file with the same id replaces the
   * old one (re-sending a corrected SPED for the month; the same NF-e twice).
   */
  documentId: string;
  /** Human label for the file list. */
  label: string;
}

interface ImporterBase {
  templateId: string;
  /** Short name shown in the screen. */
  title: string;
  /** Extensions accepted (lowercase, with the dot). */
  extensions: readonly string[];
  /** Identifies a file from its first bytes (SPED) or its whole content (documents). */
  identify(bytes: Uint8Array): FiscalIdentity;
}

export interface SpedImporter extends ImporterBase {
  mode: "sped";
  kind: SpedKind;
}

export interface DocumentImporter extends ImporterBase {
  mode: "documents";
  /** Fact table name, and each dimension's key (rows repeated across files are merged by it). */
  fact: string;
  dimensionKeys: Readonly<Record<string, string>>;
  parse(bytes: Uint8Array): FiscalTables;
}

export type FiscalImporter = SpedImporter | DocumentImporter;

/** Bytes enough to hold the first record (0000) of a SPED file. */
export const SPED_HEAD_BYTES = 4096;

const month = (isoDay: string): string => isoDay.slice(0, 7);

function spedImporter(kind: SpedKind): SpedImporter {
  return {
    mode: "sped",
    kind,
    templateId: kind.templateId,
    title: kind.title,
    extensions: [".txt"],
    identify(bytes) {
      const id = kind.identify(readSped(bytes.subarray(0, Math.min(bytes.length, SPED_HEAD_BYTES)))[0]);
      return { cnpj: id.cnpj, periodo: month(id.periodo), documentId: kind.templateId, label: `${id.nome} · ${month(id.periodo)}` };
    },
  };
}

export const FISCAL_IMPORTERS: readonly FiscalImporter[] = [
  ...SPED_KINDS.map(spedImporter),
  {
    mode: "documents",
    templateId: "nfe",
    title: "NF-e",
    extensions: [".xml"],
    fact: "nfe_itens",
    dimensionKeys: {},
    identify(bytes) {
      const id = identifyNfe(bytes);
      return { cnpj: id.cnpjEmit, periodo: month(id.periodo), documentId: id.chave, label: `NF-e ${id.chave}` };
    },
    parse: (bytes) => ({ ...parseNfe(bytes) }),
  },
];

export function fiscalImporterFor(templateId: string): FiscalImporter | null {
  return FISCAL_IMPORTERS.find((i) => i.templateId === templateId) ?? null;
}

export function checkExtension(importer: FiscalImporter, fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!importer.extensions.includes(ext)) {
    throw new FiscalFileError(`Envie arquivos ${importer.extensions.join(" ou ")} para ${importer.title}.`);
  }
  return ext;
}

/** Joins tables read from many files: every table is appended, then the keyed ones keep one row per key (last wins). */
export function mergeByKey(keys: Readonly<Record<string, string>>, parts: readonly FiscalTables[]): FiscalTables {
  const merged: FiscalTables = {};
  for (const part of parts) {
    for (const [table, rows] of Object.entries(part)) {
      (merged[table] ??= []).push(...rows);
    }
  }
  for (const [table, key] of Object.entries(keys)) {
    if (merged[table]) merged[table] = dedupeBy(merged[table], key);
  }
  return merged;
}

/** Joins the tables read from many documents: facts are appended, dimensions merged by key. */
export function mergeTables(importer: DocumentImporter, parts: readonly FiscalTables[]): FiscalTables {
  const merged = mergeByKey(importer.dimensionKeys, parts);
  for (const table of [importer.fact, ...Object.keys(importer.dimensionKeys)]) merged[table] ??= [];
  return merged;
}

/** Keys of the dimension tables the SPED kinds build (to merge what several files said). */
export const SPED_DIMENSION_KEYS: Readonly<Record<string, string>> = {
  estabelecimentos: "cnpj", participantes: "id_part", itens: "id_item", empresas: "cnpj", plano_contas: "id_cta",
};

/** Reads a whole SPED file held in memory (small files and tests; the service streams big ones). */
export function readSpedFile(kind: SpedKind, bytes: Uint8Array): { columns: string[]; rows: Cell[][]; dimensions: FiscalTables } {
  const records = readSped(bytes);
  const reader = new SpedReader(kind, records[0]);
  return { columns: factColumns(kind), rows: records.map((r) => reader.push(r)), dimensions: reader.dimensions() };
}
