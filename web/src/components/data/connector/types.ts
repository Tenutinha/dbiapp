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

/** A file of the organization's storage: its folder (relative to the organization's) and its name. */
export interface FilePick {
  folder: string;
  file: string;
}

/** Where one file of a wire is: suggested (by name) → checking → ok | diverge | failed (could not be read). */
export type FileState = "suggested" | "checking" | "ok" | "diverge" | "failed";

export interface LinkFile extends FilePick {
  state: FileState;
  check?: SchemaCheck;
  /** Why the file could not be read. */
  note?: string;
}

/**
 * The wire of one table: the files that feed it (one, or several that are joined) and where it is.
 * Lifecycle: suggested (by name) → checking → ok | diverge | failed → engaging → engaged | failed.
 * Until it is engaging, the phase follows the files (see `phaseOfFiles`).
 */
export type LinkPhase = "suggested" | "checking" | "ok" | "diverge" | "engaging" | "engaged" | "failed";

export interface Link {
  table: string;
  files: LinkFile[];
  phase: LinkPhase;
  report?: TableReport;
  /** Step of the engage ("Convertendo 2 de 5…") or why it was refused. */
  note?: string;
}

export interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}
