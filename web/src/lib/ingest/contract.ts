/**
 * Pure checks of an uploaded file's columns against a template table contract.
 */
import type { ColumnType, TemplateTable } from "../templates/schema";

export interface SourceColumn {
  name: string;
  type: string; // DuckDB type as reported by DESCRIBE
}

export interface ColumnMapping {
  /** Column in the contract. */
  target: string;
  /** Matching column in the uploaded file, or null if missing (optional columns only). */
  source: string | null;
  type: ColumnType;
  /** DuckDB type of the source column (text columns get the lenient Brazilian formats). */
  sourceType?: string;
}

export interface ContractMatch {
  mapping: ColumnMapping[];
  errors: string[];
  warnings: string[];
}

export const DUCK_TYPE: Record<ColumnType, string> = {
  integer: "BIGINT",
  decimal: "DOUBLE",
  text: "VARCHAR",
  date: "DATE",
  timestamp: "TIMESTAMP",
  boolean: "BOOLEAN",
};

/** Header normalisation: case/accents/spaces are ignored ("Valor Líquido" → "valor_liquido"). */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function matchColumns(table: TemplateTable, source: readonly SourceColumn[]): ContractMatch {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byNorm = new Map<string, SourceColumn>();
  for (const c of source) {
    const norm = normalizeName(c.name);
    const clash = byNorm.get(norm);
    if (clash) errors.push(`As colunas "${clash.name}" e "${c.name}" têm o mesmo nome — renomeie uma delas.`);
    else byNorm.set(norm, c);
  }
  if (errors.length > 0) return { mapping: [], errors, warnings };

  const mapping = table.columns.map((col): ColumnMapping => {
    const found = byNorm.get(col.name);
    if (!found && col.required) errors.push(`Coluna obrigatória "${col.name}" não encontrada.`);
    if (!found && !col.required) warnings.push(`Coluna opcional "${col.name}" ausente — ficará vazia.`);
    return { target: col.name, source: found?.name ?? null, type: col.type, ...(found ? { sourceType: found.type } : {}) };
  });

  const expected = new Set(table.columns.map((c) => c.name));
  const extras = source.filter((c) => !expected.has(normalizeName(c.name))).map((c) => c.name);
  if (extras.length > 0) warnings.push(`Colunas ignoradas (não fazem parte do contrato): ${extras.join(", ")}.`);

  return { mapping, errors, warnings };
}

/** Quote an identifier coming from an uploaded file header. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Expression converting one source column to its contract type (NULL when it does not parse). */
/** "1.234,56" or "156,74": decimal comma, optional thousands dots. */
const BR_DECIMAL = "-?[0-9]{1,3}([.][0-9]{3})+,[0-9]+|-?[0-9]+,[0-9]+";
const BR_DATE = "'%d/%m/%Y'";
const BR_TIMESTAMP = "['%d/%m/%Y %H:%M:%S', '%d/%m/%Y %H:%M', '%d/%m/%Y']";

/**
 * Text that the plain cast refuses but is a usual Brazilian spelling of the type: numbers with a decimal
 * comma and dates as dd/mm/aaaa (what CSV exports of local systems bring). Null when it is neither.
 */
function lenientCast(source: string, type: ColumnType): string | null {
  const text = `trim(${source})`;
  if (type === "decimal") {
    return `CASE WHEN regexp_full_match(${text}, '${BR_DECIMAL}') THEN TRY_CAST(replace(replace(${text}, '.', ''), ',', '.') AS DOUBLE) END`;
  }
  if (type === "date") return `TRY_CAST(try_strptime(${text}, ${BR_DATE}) AS DATE)`;
  if (type === "timestamp") return `try_strptime(${text}, ${BR_TIMESTAMP})`;
  return null;
}

export function castExpr(m: ColumnMapping): string {
  if (m.source === null) return `CAST(NULL AS ${DUCK_TYPE[m.type]})`;
  const source = quoteIdent(m.source);
  const plain = `TRY_CAST(${source} AS ${DUCK_TYPE[m.type]})`;
  const lenient = m.sourceType === "VARCHAR" ? lenientCast(source, m.type) : null;
  return lenient ? `COALESCE(${plain}, ${lenient})` : plain;
}

/** SELECT list that casts the source file into the contract shape. */
export function castSelect(mapping: readonly ColumnMapping[]): string {
  return mapping.map((m) => `${castExpr(m)} AS ${m.target}`).join(", ");
}
