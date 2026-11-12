"use client";

import { useMemo } from "react";
import { isPicked } from "@/lib/query/cross";
import { ScrollTable, type ScrollColumn, type SortValue, type TableSort } from "./ScrollTable";
import { useCrossFilter } from "./useCrossFilter";

interface CrossTableProps {
  /** Id of the visual in the template: names its cross-filter selection. */
  visualId: string;
  /** Grouped fields of the table, in column order: a click on a row picks its value in each of them. */
  fields: readonly string[];
  /** Value of each field per row (same order as `rows`). */
  keys: readonly (readonly string[])[];
  columns: readonly ScrollColumn[];
  rows: readonly (readonly string[])[];
  sortValues?: readonly (readonly SortValue[])[];
  note?: string;
  /** The order the rows come in, when it is by one column (see ScrollTable). */
  initialSort?: TableSort;
  /** The line of totals, in column order (see ScrollTable). */
  footer?: readonly string[];
}

/** Aggregated table whose rows cross-filter the other visuals when clicked. */
export function CrossTable({ visualId, fields, keys, columns, rows, sortValues, note, initialSort, footer }: CrossTableProps) {
  const { own, pick, pending } = useCrossFilter(visualId, fields);

  const selected = useMemo(() => {
    const picked = new Set<number>();
    keys.forEach((key, i) => {
      if (isPicked(own, Object.fromEntries(fields.map((f, j) => [f, key[j]])))) picked.add(i);
    });
    return picked;
  }, [own, keys, fields]);

  const onRowClick = (index: number, additive: boolean): void => {
    pick(fields.map((fieldId, j) => ({ fieldId, value: keys[index][j] })), additive);
  };

  return (
    <div className={`transition-opacity ${pending ? "opacity-60" : ""}`}>
      <ScrollTable columns={columns} rows={rows} sortValues={sortValues} note={note} selectedRows={selected} onRowClick={onRowClick} initialSort={initialSort} footer={footer} />
    </div>
  );
}
