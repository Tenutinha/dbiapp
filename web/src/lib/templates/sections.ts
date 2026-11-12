/**
 * Page layout from a template's analyses: visuals grouped into sections, and the numbered
 * summary the sidebar shows. Pure, safe in server and client components.
 */
import type { Analysis, Template, Visual } from "./schema";

/** Element id of an analysis section, for links from the summary. */
export const analysisAnchor = (analysisId: string): string => `analise-${analysisId.replace(/_/g, "-")}`;

export interface Section<R> {
  analysis: Analysis;
  /** Position in the summary (1-based), or null when the analysis is not listed there. */
  number: number | null;
  anchor: string;
  results: R[];
}

export interface PageSections<R> {
  /** Visuals outside every analysis, shown before the first section. */
  loose: R[];
  sections: Section<R>[];
}

export interface SummaryItem {
  id: string;
  title: string;
  number: number;
  anchor: string;
}

export interface SummaryGroupView {
  title: string;
  items: SummaryItem[];
}

/** Analysis id → its number in the summary (reading order across groups). */
function summaryNumbers(t: Template): Map<string, number> {
  const hidden = new Set(t.analyses.filter((a) => a.hidden).map((a) => a.id));
  return new Map(t.summary.flatMap((g) => g.analyses).filter((id) => !hidden.has(id)).map((id, i) => [id, i + 1]));
}

/**
 * The template as readers get it: hidden analyses (off the air) and their visuals left out, so they are
 * neither listed, shown nor computed.
 */
export function withoutHidden(t: Template): Template {
  const hidden = t.analyses.filter((a) => a.hidden);
  if (hidden.length === 0) return t;
  const ids = new Set(hidden.map((a) => a.id));
  const visuals = new Set(hidden.flatMap((a) => a.visuals));
  return {
    ...t,
    analyses: t.analyses.filter((a) => !ids.has(a.id)),
    visuals: t.visuals.filter((v) => !visuals.has(v.id)),
    summary: t.summary.map((g) => ({ ...g, analyses: g.analyses.filter((id) => !ids.has(id)) })).filter((g) => g.analyses.length > 0),
  };
}

export function buildSummary(t: Template): SummaryGroupView[] {
  const numbers = summaryNumbers(t);
  const titleOf = new Map(t.analyses.filter((a) => !a.hidden).map((a) => [a.id, a.title]));
  return t.summary
    .map((g) => ({
      title: g.title,
      items: g.analyses
        .filter((id) => titleOf.has(id))
        .map((id) => ({ id, title: titleOf.get(id) ?? id, number: numbers.get(id) ?? 0, anchor: analysisAnchor(id) })),
    }))
    .filter((g) => g.items.length > 0);
}

/** The summary as one flat list, in reading order: the analyses shown under a dashboard in the sidebar. */
export function buildOutline(t: Template): SummaryItem[] {
  return buildSummary(t).flatMap((g) => g.items);
}

/** Splits computed visuals (anything carrying `visual`) into the page's loose block and its sections. */
export function buildSections<R extends { visual: Pick<Visual, "id"> }>(t: Template, results: readonly R[]): PageSections<R> {
  const byId = new Map(results.map((r) => [r.visual.id, r]));
  const placed = new Set(t.analyses.flatMap((a) => a.visuals));
  const numbers = summaryNumbers(t);
  return {
    loose: results.filter((r) => !placed.has(r.visual.id)),
    sections: t.analyses.map((analysis) => ({
      analysis,
      number: numbers.get(analysis.id) ?? null,
      anchor: analysisAnchor(analysis.id),
      results: analysis.visuals.flatMap((id) => {
        const r = byId.get(id);
        return r ? [r] : [];
      }),
    })),
  };
}
