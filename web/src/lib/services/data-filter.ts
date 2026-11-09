import "server-only";
import type { InstanceAccess } from "../access";
import { DataFilterUnavailableError, getDataFilterRaw, setDataFilter } from "../data/instances";
import { getDraft, listFiles } from "../data/repository";
import { queryRows, quotePath, withConnection } from "../duck/engine";
import { quoteIdent } from "../ingest/contract";
import { EMPTY_VALUE, factFilterSql, parseFactFilter, type FactFilterRule } from "../query/fact-filter";
import { storage } from "../storage";
import { factColumns } from "./dashboard";
import { requireTemplate, UserFacingError } from "./datasets";

/**
 * Data filter of a dashboard, as the data manager edits it: the fact table's columns, the distinct
 * values of one column (with how many rows each has), a preview of how many rows a filter keeps, and save.
 * Values are read from the published fact file — or the draft's, before the first publication.
 */

export interface DataFilterState {
  filter: FactFilterRule[];
  columns: { name: string; type: string }[];
  /** Null when the dashboard has no fact file yet (nothing to filter on). */
  totalRows: number | null;
  keptRows: number | null;
  /** The fact file exists but could not be read. */
  factError?: string;
}

export interface ColumnValues {
  column: string;
  values: { value: string; rows: number }[];
  /** More distinct values than listed. */
  truncated: boolean;
}

const MAX_LISTED_VALUES = 300;

async function factFile(access: InstanceAccess): Promise<string | null> {
  const template = await requireTemplate(access.templateId);
  const fact = template.tables.find((t) => t.kind === "fact")?.name;
  const draft = await getDraft(access.instanceId);
  for (const versionId of [access.activeVersionId, draft?.id]) {
    if (!versionId) continue;
    const file = (await listFiles(versionId)).find((f) => f.tableName === fact);
    if (file) {
      try {
        return await storage.localPath(file.storagePath);
      } catch (err) {
        console.error("[data-filter] could not open the fact file", access.instanceId, file.storagePath, err);
        throw new UserFacingError("Não foi possível abrir o arquivo da tabela fato. Engate ou suba a tabela fato de novo.");
      }
    }
  }
  return null;
}

async function countKept(file: string, filter: readonly FactFilterRule[]): Promise<{ total: number; kept: number }> {
  return withConnection(storage.workRoot, async (conn) => {
    const params: string[] = [];
    const where = factFilterSql(filter, params);
    const [row] = await queryRows(
      conn,
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (${where || "WHERE true"}) AS kept FROM read_parquet(${quotePath(file)})`,
      params,
    );
    return { total: Number(row.total), kept: Number(row.kept) };
  });
}

async function columnsOf(access: InstanceAccess): Promise<{ names: string[]; columns: DataFilterState["columns"] }> {
  const template = await requireTemplate(access.templateId);
  const fact = template.tables.find((t) => t.kind === "fact");
  return { names: factColumns(template), columns: fact?.columns.map((c) => ({ name: c.name, type: c.type })) ?? [] };
}

export async function loadDataFilter(access: InstanceAccess): Promise<DataFilterState> {
  const [{ names, columns }, raw] = await Promise.all([columnsOf(access), getDataFilterRaw(access.instanceId)]);
  const filter = parseFactFilter(raw, names);
  let file: string | null;
  try {
    file = await factFile(access);
  } catch (err) {
    // The saved rules still show (and can be removed); only counting and listing values need the file.
    if (err instanceof UserFacingError) return { filter, columns, totalRows: null, keptRows: null, factError: err.message };
    throw err;
  }
  if (!file) return { filter, columns, totalRows: null, keptRows: null };
  const { total, kept } = await countKept(file, filter);
  return { filter, columns, totalRows: total, keptRows: kept };
}

/** Distinct values of one fact column, most frequent first. */
export async function columnValues(access: InstanceAccess, column: string): Promise<ColumnValues> {
  const { names } = await columnsOf(access);
  if (!names.includes(column)) throw new UserFacingError("Coluna não faz parte da tabela fato.");
  const file = await factFile(access);
  if (!file) throw new UserFacingError("Suba a tabela fato antes de filtrar.");
  return withConnection(storage.workRoot, async (conn) => {
    const rows = await queryRows(
      conn,
      `SELECT COALESCE(CAST(${quoteIdent(column)} AS VARCHAR), '${EMPTY_VALUE}') AS value, COUNT(*) AS n
       FROM read_parquet(${quotePath(file)}) GROUP BY 1 ORDER BY n DESC, value LIMIT ${MAX_LISTED_VALUES + 1}`,
    );
    return {
      column,
      values: rows.slice(0, MAX_LISTED_VALUES).map((r) => ({ value: String(r.value), rows: Number(r.n) })),
      truncated: rows.length > MAX_LISTED_VALUES,
    };
  });
}

/** How many fact rows a (not yet saved) filter keeps. */
export async function previewDataFilter(access: InstanceAccess, raw: unknown): Promise<{ totalRows: number; keptRows: number }> {
  const { names } = await columnsOf(access);
  const file = await factFile(access);
  if (!file) throw new UserFacingError("Suba a tabela fato antes de filtrar.");
  const { total, kept } = await countKept(file, parseFactFilter(raw, names));
  return { totalRows: total, keptRows: kept };
}

export async function saveDataFilter(access: InstanceAccess, raw: unknown): Promise<FactFilterRule[]> {
  const { names } = await columnsOf(access);
  const filter = parseFactFilter(raw, names);
  try {
    await setDataFilter(access.instanceId, filter);
  } catch (err) {
    if (err instanceof DataFilterUnavailableError) {
      throw new UserFacingError("O banco ainda não tem o campo de filtro (migração 010). Peça para aplicar a migração.");
    }
    throw err;
  }
  return filter;
}
