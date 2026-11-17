import { crossKey } from "@/lib/query/cross";
import type { FilterData } from "./live-types";

/**
 * What the filter bar shows between a change of the selection and the server's answer for it: the options
 * it had, with what the address now says is chosen. A filter of several values follows the address; one of
 * a single value follows it when the address names one (else it keeps what the server had settled); an item
 * picked in a visual stays while the address still holds it (a new one shows up with the answer, which
 * knows how to name it). Pure.
 */
export function shownSelection(data: FilterData, params: URLSearchParams): FilterData {
  return {
    filters: data.filters.map((f) => {
      const chosen = params.getAll(`f.${f.fieldId}`);
      if (f.single) return chosen.length > 0 ? { ...f, selected: [chosen[0]] } : f;
      return { ...f, selected: chosen };
    }),
    cross: data.cross.flatMap((c) => {
      const values = params.getAll(crossKey(c.visualId, c.fieldId));
      return values.length > 0 ? [{ ...c, values }] : [];
    }),
  };
}
