/**
 * Which templates accept raw fiscal files, and how each file is identified and read.
 * Pure: the service (services/fiscal.ts) does the storage and ingestion around it.
 */
import { identifyEcd, parseEcd } from "./ecd";
import { identifyEfdContrib, parseEfdContrib } from "./efd-contribuicoes";
import { identifyEfdIcms, parseEfdIcms } from "./efd-icms-ipi";
import { identifyNfe, parseNfe } from "./nfe";
import { dedupeBy, FiscalFileError, readSped, type Row } from "./sped";

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

export interface FiscalImporter {
  templateId: string;
  /** Short name shown in the screen. */
  title: string;
  /** Extensions accepted (lowercase, with the dot). */
  extensions: readonly string[];
  /** Fact table name, and each dimension's key (rows repeated across files are merged by it). */
  fact: string;
  dimensionKeys: Readonly<Record<string, string>>;
  identify(bytes: Uint8Array): FiscalIdentity;
  parse(bytes: Uint8Array): FiscalTables;
}

const month = (isoDay: string): string => isoDay.slice(0, 7);

function spedImporter(
  templateId: string, title: string, fact: string, dimensionKeys: Record<string, string>,
  identify: (r: ReturnType<typeof readSped>) => { cnpj: string; nome: string; periodo: string },
  parse: (r: ReturnType<typeof readSped>) => object,
): FiscalImporter {
  return {
    templateId, title, extensions: [".txt"], fact, dimensionKeys,
    identify(bytes) {
      // Identification only needs the first record; avoid decoding the whole file twice.
      const records = readSped(bytes.subarray(0, Math.min(bytes.length, 4096)));
      const id = identify(records);
      return { cnpj: id.cnpj, periodo: month(id.periodo), documentId: templateId, label: `${id.nome} · ${month(id.periodo)}` };
    },
    parse(bytes) {
      return parse(readSped(bytes)) as FiscalTables;
    },
  };
}

export const FISCAL_IMPORTERS: readonly FiscalImporter[] = [
  spedImporter("efd-icms-ipi", "EFD ICMS/IPI", "documentos_analitico",
    { estabelecimentos: "cnpj", participantes: "id_part" }, identifyEfdIcms, parseEfdIcms),
  spedImporter("efd-contribuicoes", "EFD Contribuições", "itens_pis_cofins",
    { estabelecimentos: "cnpj", participantes: "id_part", itens: "id_item" }, identifyEfdContrib, parseEfdContrib),
  spedImporter("ecd", "ECD", "saldos_contas", { empresas: "cnpj", plano_contas: "id_cta" }, identifyEcd, parseEcd),
  {
    templateId: "nfe",
    title: "NF-e",
    extensions: [".xml"],
    fact: "nfe_itens",
    dimensionKeys: { emitentes: "cnpj_emit", destinatarios: "doc_dest" },
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

/** Joins the tables read from many files: facts are appended, dimensions merged by key (last wins). */
export function mergeTables(importer: FiscalImporter, parts: readonly FiscalTables[]): FiscalTables {
  const merged: FiscalTables = {};
  for (const part of parts) {
    for (const [table, rows] of Object.entries(part)) {
      (merged[table] ??= []).push(...rows);
    }
  }
  for (const [table, key] of Object.entries(importer.dimensionKeys)) {
    merged[table] = dedupeBy(merged[table] ?? [], key);
  }
  merged[importer.fact] ??= [];
  return merged;
}
