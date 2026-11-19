/**
 * Marks a strip of visuals side by side inside one analysis (its "row" layout). The header's scrollbar drives
 * the one on screen, and while it does hides the strip's native bar with a rule of its own (nativeBarRule): it
 * never writes on the strip, which may not be hydrated yet when the header is.
 * Plain constants (no "use client"): the strip is drawn on the server.
 */
export const CARD_STRIP_ATTR = "data-card-strip";
/** Marks each card of such a strip (and the placeholder of the cards still to come): one page of its scrollbar. */
export const STRIP_CARD_ATTR = "data-strip-card";
/** Classes of a card of the strip: a little narrower than the page, so the next one peeks in and says the strip goes on. */
export const STRIP_CARD_CLASS = "w-[calc(100%-3rem)] shrink-0 snap-start";

/**
 * A strip with many visuals (every record of a file, one listing each) is brought in runs of this many, as
 * the reader turns it: nobody waits for hundreds of queries to see the first listing.
 */
export const STRIP_RUN = 8;
/** A strip is brought in runs when it has more visuals than this. */
export const STRIP_RUNS_FROM = 12;

const RUN_MARK = ":";

/** The part of the page that is one run of an analysis' strip (see lib/services/dashboard loadParts). */
export const runPart = (analysisId: string, run: number): string => `${analysisId}${RUN_MARK}${run}`;

/** Reads a part id: an analysis (or "" for the visuals outside any), or one run of an analysis' strip. */
export function readPart(part: string): { analysisId: string; run: number | null } {
  const at = part.indexOf(RUN_MARK);
  return at < 0 ? { analysisId: part, run: null } : { analysisId: part.slice(0, at), run: Number(part.slice(at + 1)) };
}

/** How many runs a strip of `visuals` visuals comes in (0: it comes whole). */
export const runsOf = (visuals: number): number => (visuals > STRIP_RUNS_FROM ? Math.ceil(visuals / STRIP_RUN) : 0);

/**
 * The CSS that hides the native scrollbar of the strip of visuals in one analysis (by the analysis' id), while
 * the header's bar stands for it. Null for an id that can't go in a selector safely.
 */
export function nativeBarRule(analysisAnchor: string): string | null {
  if (!/^[A-Za-z][\w-]{0,200}$/.test(analysisAnchor)) return null;
  const strip = `[id="${analysisAnchor}"] [${CARD_STRIP_ATTR}]`;
  return `${strip}{scrollbar-width:none}${strip}::-webkit-scrollbar{display:none}`;
}
