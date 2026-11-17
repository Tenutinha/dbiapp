import type { Template } from "./schema";

/**
 * The summary people arranged on the screen, plus the analyses the catalog has never had: a new one enters the
 * group the file lists it under, right after the analysis that comes before it there (it would otherwise stay
 * off the air until someone found it in the editor). One the catalog already had and left out stays out.
 */
export function withNewAnalyses(kept: Template["summary"], fromFile: Template["summary"], hadBefore: ReadonlySet<string>): Template["summary"] {
  let summary = kept;
  for (const group of fromFile) {
    group.analyses.forEach((id, i) => {
      if (hadBefore.has(id) || summary.some((g) => g.analyses.includes(id))) return;
      const target = summary.find((g) => g.title === group.title);
      if (!target) {
        summary = [...summary, { title: group.title, analyses: [id] }];
        return;
      }
      // After the nearest analysis before it in the file that this group shows; first when none does.
      const before = group.analyses.slice(0, i).reverse().find((other) => target.analyses.includes(other));
      const at = before === undefined ? 0 : target.analyses.indexOf(before) + 1;
      summary = summary.map((g) => (g === target ? { ...g, analyses: [...g.analyses.slice(0, at), id, ...g.analyses.slice(at)] } : g));
    });
  }
  return summary;
}
