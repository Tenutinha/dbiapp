/** Lowercase without accents and surrounding spaces, so "votacao" finds "Votação". */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Client-side search: every word of the query appears somewhere in the text (accent- and case-insensitive). */
export function matchesQuery(text: string, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldText(text);
  return words.every((w) => haystack.includes(w));
}
