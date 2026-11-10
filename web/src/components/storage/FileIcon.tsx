import { fileKind, type FileKindId } from "@/lib/storage-explorer";

/** Colour and short tag per file type, like the coloured badges of a desktop file manager. */
const STYLE: Record<FileKindId, { color: string; tag: string }> = {
  parquet: { color: "#7c3aed", tag: "PQ" },
  csv: { color: "#16a34a", tag: "CSV" },
  text: { color: "#0284c7", tag: "TXT" },
  xml: { color: "#ea580c", tag: "XML" },
  json: { color: "#ca8a04", tag: "{ }" },
  zip: { color: "#78716c", tag: "ZIP" },
  excel: { color: "#15803d", tag: "XLS" },
  pdf: { color: "#dc2626", tag: "PDF" },
  pbix: { color: "#eab308", tag: "PBI" },
  other: { color: "#64748b", tag: "" },
};

function FolderShape({ size, open, client }: { size: number; open?: boolean; client?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M4 12a4 4 0 0 1 4-4h11l5 5h16a4 4 0 0 1 4 4v3H4z" fill="#e0a526" />
      <path d={open ? "M2 20h44l-4 20H6z" : "M4 18h40v20a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"} fill="#f6c443" />
      {client && <circle cx="36" cy="34" r="7" fill="#2563eb" stroke="#fff" strokeWidth="2" />}
      {client && <path d="M33 34.5l2.2 2.2 4-4.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

function DocShape({ size, name }: { size: number; name: string }) {
  const { color, tag } = STYLE[fileKind(name).kind];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M10 4h20l10 10v28a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fff" stroke="#cbd5e1" strokeWidth="1.5" />
      <path d="M30 4v8a2 2 0 0 0 2 2h8" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="1.5" />
      {tag && <rect x="4" y="26" width={tag.length > 2 ? 30 : 24} height="12" rx="2" fill={color} />}
      {tag && <text x={tag.length > 2 ? 19 : 16} y="35" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">{tag}</text>}
    </svg>
  );
}

interface FileIconProps {
  name: string;
  folder: boolean;
  size?: number;
  /** A client's own folder (marked with a badge). */
  client?: boolean;
  open?: boolean;
}

export function FileIcon({ name, folder, size = 20, client, open }: FileIconProps) {
  return folder ? <FolderShape size={size} open={open} client={client} /> : <DocShape size={size} name={name} />;
}
