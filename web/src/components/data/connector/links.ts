import type { FilePick, Link, LinkFile, LinkPhase } from "./types";

export const sameFile = (a: FilePick, b: FilePick): boolean => a.folder === b.folder && a.file === b.file;

/** Replaces the link of one table (immutably). */
export function putLink(links: readonly Link[], link: Link): Link[] {
  return [...links.filter((l) => l.table !== link.table), link];
}

/**
 * Where a wire is, from its files: still checking while any file is; refused when any diverges or could
 * not be read (the engage needs every file); ready only when all of them fit.
 */
export function phaseOfFiles(files: readonly LinkFile[]): LinkPhase {
  const has = (state: LinkFile["state"]): boolean => files.some((f) => f.state === state);
  if (has("suggested")) return "suggested";
  if (has("checking")) return "checking";
  if (has("diverge")) return "diverge";
  if (has("failed")) return "failed";
  return "ok";
}

/** A wire with other files: back to what the files say, and what an earlier engage reported is gone. */
function rewired(table: string, files: LinkFile[]): Link {
  return { table, files, phase: phaseOfFiles(files) };
}

/**
 * Adds files to a table's wire, each one to be checked. A file that is already there is checked again
 * instead of repeated, and a name-based suggestion gives way to what the person chose.
 */
export function addFiles(links: readonly Link[], table: string, picks: readonly FilePick[]): Link[] {
  const current = links.find((l) => l.table === table);
  if (current?.phase === "engaging") return [...links];
  const kept = (current?.files ?? []).filter((f) => f.state !== "suggested" && !picks.some((p) => sameFile(p, f)));
  const added = picks
    .filter((p, i) => picks.findIndex((q) => sameFile(p, q)) === i)
    .map((p): LinkFile => ({ folder: p.folder, file: p.file, state: "checking" }));
  // In place: the wire does not jump to the end of the list when a file is added.
  const next = rewired(table, [...kept, ...added]);
  return current ? links.map((l) => (l.table === table ? next : l)) : [...links, next];
}

/** Takes one file off a table's wire; the wire goes with its last file. */
export function removeFile(links: readonly Link[], table: string, pick: FilePick): Link[] {
  return links.flatMap((l) => {
    if (l.table !== table || l.phase === "engaging") return [l];
    const files = l.files.filter((f) => !sameFile(f, pick));
    if (files.length === l.files.length) return [l];
    return files.length === 0 ? [] : [rewired(table, files)];
  });
}

/** Result of checking one file. Ignored when the file was taken off the wire meanwhile. */
export function setFileCheck(
  links: readonly Link[], table: string, pick: FilePick, result: Pick<LinkFile, "state" | "check" | "note">,
): Link[] {
  return links.map((l) => {
    if (l.table !== table || l.phase === "engaging" || !l.files.some((f) => sameFile(f, pick) && f.state === "checking")) return l;
    return rewired(table, l.files.map((f) => (sameFile(f, pick) ? { folder: f.folder, file: f.file, ...result } : f)));
  });
}

/**
 * Wires after the folder was listed again: every wire the person made (a chosen file being checked,
 * checked, engaging, engaged or failed) stays as it is, and only the name-based suggestions are renewed,
 * for the tables that have no wire of their own.
 *
 * The list is refreshed whenever the file picker closes, so dropping wires here would undo the choice
 * that was just made in it.
 */
export function withSuggestions(
  links: readonly Link[], suggestions: readonly { table: string; file: string }[], folder: string,
): Link[] {
  const kept = links.filter((l) => l.phase !== "suggested");
  const wired = new Set(kept.map((l) => l.table));
  return [
    ...kept,
    ...suggestions
      .filter((s) => !wired.has(s.table))
      .map((s): Link => ({ table: s.table, files: [{ folder, file: s.file, state: "suggested" }], phase: "suggested" })),
  ];
}
