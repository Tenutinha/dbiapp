import type { TableReport } from "@/lib/ingest/ingest";
import type { SchemaCheck } from "@/lib/ingest/schema-check";

/** A contract table of the dashboard, as the connector shows it (right column). */
export interface ConnectorTable {
  name: string;
  kind: "fact" | "dimension";
  description: string;
  columns: { name: string; type: string; required: boolean }[];
  /** What the dashboard already has for it. */
  status: { tone: "ok" | "draft" | "missing"; label: string };
}

export interface ConnectorFile {
  name: string;
  sizeBytes: number;
  /** Data file that can be wired to a table (other files are only kept in the folder). */
  engageable: boolean;
}

/**
 * One wire file → table. Lifecycle: suggested (by name) → checking → ok | diverge → engaging →
 * engaged | failed. An upload through the table's plug goes straight to engaging (file = the upload).
 */
export type LinkPhase = "suggested" | "checking" | "ok" | "diverge" | "engaging" | "engaged" | "failed";

export interface Link {
  table: string;
  file: string;
  /** Folder of the file in the organization's storage (relative to its folder); absent for plug uploads. */
  folder?: string;
  /** The file came from the computer (plug upload), not from the storage folder. */
  uploaded?: boolean;
  phase: LinkPhase;
  check?: SchemaCheck;
  report?: TableReport;
  /** Upload step ("Enviando", "Validando") or an error message. */
  note?: string;
}

export interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}
