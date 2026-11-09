/**
 * Shared helpers to read SPED files (EFD ICMS/IPI, EFD Contribuições, ECD).
 *
 * A SPED file is plain text in ISO-8859-1, one record per line: `|REG|campo1|campo2|…|`.
 * Dates come as DDMMAAAA and numbers with a decimal comma. Pure: no I/O.
 */

/** One record: the fields between the pipes, `fields[0]` being the record name (e.g. "C190"). */
export type SpedRecord = readonly string[];

/** Value of a table row as written to the intermediate CSV (null = empty cell). */
export type Cell = string | null;
export type Row = Record<string, Cell>;

/** Decodes the file (ISO-8859-1, as the SPED layouts require) and splits it into records. */
export function readSped(bytes: Uint8Array): SpedRecord[] {
  const text = new TextDecoder("latin1").decode(bytes);
  const records: SpedRecord[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    // Signature block (after |9999|) is binary noise: stop there.
    const fields = line.split("|").slice(1, -1);
    if (fields.length === 0) continue;
    records.push(fields);
    if (fields[0] === "9999") break;
  }
  return records;
}

/** "31012025" → "2025-01-31"; anything else → null. */
export function spedDate(v: string | undefined): string | null {
  if (!v || !/^\d{8}$/.test(v)) return null;
  return `${v.slice(4, 8)}-${v.slice(2, 4)}-${v.slice(0, 2)}`;
}

/** First day of the month of a SPED date: "15012025" → "2025-01-01". */
export function spedMonth(v: string | undefined): string | null {
  const d = spedDate(v);
  return d ? `${d.slice(0, 7)}-01` : null;
}

/** "1.234,56" or "1234,56" → "1234.56"; empty → null. */
export function spedNumber(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  if (t === "") return null;
  const n = t.replace(/\./g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(n) ? n : null;
}

/** Trimmed text; empty → null. */
export function text(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** IBGE state code (first two digits of a municipality code) → UF. */
const UF_BY_IBGE: Readonly<Record<string, string>> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

export function ufFromMunicipio(codMun: string | undefined): string | null {
  const code = (codMun ?? "").trim();
  if (code === "9999999") return "EX";
  return UF_BY_IBGE[code.slice(0, 2)] ?? null;
}

/** Keys of participants, items and accounts only hold inside one file: prefix them with the declarant's CNPJ. */
export function scopedKey(cnpj: string, code: string | undefined): string | null {
  const c = text(code);
  return c === null ? null : `${cnpj}-${c}`;
}

/** Keeps the last row per key (dimensions repeat across monthly files). */
export function dedupeBy(rows: readonly Row[], key: string): Row[] {
  const byKey = new Map<string, Row>();
  for (const r of rows) {
    const k = r[key];
    if (k !== null && k !== undefined) byKey.set(k, r);
  }
  return [...byKey.values()];
}

/** What identifies a SPED file: who declares and which period it covers. */
export interface SpedIdentity {
  cnpj: string;
  nome: string;
  /** First day of the period (YYYY-MM-DD). */
  periodo: string;
  dtFin: string | null;
}

export class FiscalFileError extends Error {}
