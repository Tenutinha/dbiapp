import type { Link } from "./types";

/** Replaces the link of one table (immutably). */
export function putLink(links: readonly Link[], link: Link): Link[] {
  return [...links.filter((l) => l.table !== link.table), link];
}

/**
 * Wires after the folder was listed again: every wire the person made (a chosen file being checked,
 * checked, engaging, engaged, failed, or an upload) stays as it is, and only the name-based suggestions
 * are renewed, for the tables that have no wire of their own.
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
      .map((s): Link => ({ table: s.table, folder, file: s.file, phase: "suggested" })),
  ];
}
