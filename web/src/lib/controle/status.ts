/**
 * The situation of an entry: "pendente" until the person confirms it happened (the money came in or
 * went out), then "efetivado". Pure — shared by the page, the forms and the API.
 */

export const STATUSES = ["pendente", "efetivado"] as const;
export type EntryStatus = (typeof STATUSES)[number];

/** How each situation reads for a sale and for an expense. */
export const STATUS_LABEL: Record<"venda" | "despesa", Record<EntryStatus, string>> = {
  venda: { efetivado: "Recebida", pendente: "A receber" },
  despesa: { efetivado: "Paga", pendente: "A pagar" },
};

/** The filter of the screen: everything, or only one situation. */
export type StatusFilter = EntryStatus | null;

/** `?status=` of the address; anything else is "everything". */
export function parseStatus(value: string | string[] | undefined): StatusFilter {
  const text = Array.isArray(value) ? value[0] : value;
  return (STATUSES as readonly string[]).includes(text ?? "") ? (text as EntryStatus) : null;
}

/** Joins the parts of a query string that are not empty: ("mes=2026-10", "status=pendente") → "mes=2026-10&status=pendente". */
export function joinQuery(...parts: string[]): string {
  return parts.filter(Boolean).join("&");
}

/** The status part of the address ("" when showing everything). */
export const statusQuery = (status: StatusFilter): string => (status ? `status=${status}` : "");
