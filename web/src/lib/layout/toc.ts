/**
 * Sidebar table of contents and the admin "organizar" draft. Pure — no I/O.
 */
import { z } from "zod";
import { formatDateShort } from "../format";

export interface SectionRow {
  id: string;
  title: string;
  position: number;
}

export interface DashboardRow {
  id: string;
  name: string;
  description: string | null;
  sectionId: string | null;
  position: number;
  templateId: string;
  published: boolean;
  publishedAt: Date | null;
}

export interface TocItem extends DashboardRow {
  /** 1-based number shown next to the title, continuous across sections. */
  number: number;
}

export interface TocGroup {
  section: { id: string; title: string } | null;
  items: TocItem[];
}

export interface TocOptions {
  /** Managers also see dashboards still waiting for data. */
  includeUnpublished: boolean;
  /** Editors see empty sections so they can fill them. */
  includeEmptySections: boolean;
}

const byPosition = <T extends { position: number }>(a: T, b: T): number => a.position - b.position;

export function buildToc(sections: readonly SectionRow[], dashboards: readonly DashboardRow[], opts: TocOptions): TocGroup[] {
  const known = new Set(sections.map((s) => s.id));
  const visible = dashboards
    .filter((d) => opts.includeUnpublished || d.published)
    .slice()
    .sort((a, b) => byPosition(a, b) || a.name.localeCompare(b.name, "pt-BR"));
  const inSection = (id: string | null): DashboardRow[] =>
    visible.filter((d) => (id === null ? d.sectionId === null || !known.has(d.sectionId) : d.sectionId === id));

  const groups: { section: TocGroup["section"]; rows: DashboardRow[] }[] = [
    { section: null, rows: inSection(null) },
    ...sections
      .slice()
      .sort(byPosition)
      .map((s) => ({ section: { id: s.id, title: s.title }, rows: inSection(s.id) })),
  ];

  let n = 0;
  return groups
    .filter((g) => g.rows.length > 0 || (g.section !== null && opts.includeEmptySections))
    .map((g) => ({ section: g.section, items: g.rows.map((r) => ({ ...r, number: ++n })) }));
}

/** First dashboard a reader should land on. */
export function firstItem(toc: readonly TocGroup[]): TocItem | null {
  return toc.flatMap((g) => g.items).find((i) => i.published) ?? null;
}

/** The dashboard after the open one in reading order (across sections); null at the last or when unknown. */
export function nextItem(toc: readonly TocGroup[], currentId: string): TocItem | null {
  const items = toc.flatMap((g) => g.items);
  const at = items.findIndex((i) => i.id === currentId);
  return at < 0 ? null : (items[at + 1] ?? null);
}

/** The dashboard before this one in the reading order (null for the first, or one that is not listed). */
export function previousItem(toc: readonly TocGroup[], currentId: string): TocItem | null {
  const items = toc.flatMap((g) => g.items);
  const at = items.findIndex((i) => i.id === currentId);
  return at <= 0 ? null : items[at - 1];
}

// ---------- admin draft ----------

const uuid = z.string().uuid();

export const layoutDraftSchema = z.object({
  ungrouped: z.array(uuid).max(500),
  sections: z
    .array(
      z.object({
        /** null = new section */
        id: uuid.nullable(),
        title: z.string().trim().min(1, "Toda seção precisa de um título.").max(80),
        items: z.array(uuid).max(500),
      }),
    )
    .max(50),
  dashboards: z
    .array(
      z.object({
        id: uuid,
        name: z.string().trim().min(1, "Todo dashboard precisa de um título.").max(120),
        description: z.string().trim().max(280),
      }),
    )
    .max(500),
});
export type LayoutDraft = z.infer<typeof layoutDraftSchema>;

export interface LayoutPlan {
  sections: { id: string | null; title: string; position: number }[];
  deleteSectionIds: string[];
  /** sectionIndex points into `sections` (null = no section). */
  placements: { dashboardId: string; sectionIndex: number | null; position: number }[];
  renames: { id: string; name: string; description: string | null }[];
}

export class LayoutError extends Error {}

/**
 * Validates a draft against what exists in the space and turns it into a write plan.
 * Dashboards the draft forgot (e.g. activated meanwhile) are kept, appended without section.
 */
export function planLayout(
  draft: LayoutDraft,
  existing: { sectionIds: readonly string[]; dashboardIds: readonly string[] },
): LayoutPlan {
  const sectionIds = new Set(existing.sectionIds);
  const dashboardIds = new Set(existing.dashboardIds);
  const seen = new Set<string>();

  const place = (id: string): void => {
    if (!dashboardIds.has(id)) throw new LayoutError("Dashboard desconhecido neste espaço.");
    if (seen.has(id)) throw new LayoutError("Um dashboard apareceu duas vezes.");
    seen.add(id);
  };

  const usedSections = new Set<string>();
  draft.sections.forEach((s) => {
    if (s.id === null) return;
    if (!sectionIds.has(s.id)) throw new LayoutError("Seção desconhecida neste espaço.");
    if (usedSections.has(s.id)) throw new LayoutError("Uma seção apareceu duas vezes.");
    usedSections.add(s.id);
  });

  let position = 0;
  const placements: LayoutPlan["placements"] = [];
  draft.ungrouped.forEach((id) => {
    place(id);
    placements.push({ dashboardId: id, sectionIndex: null, position: ++position });
  });
  draft.sections.forEach((s, sectionIndex) =>
    s.items.forEach((id) => {
      place(id);
      placements.push({ dashboardId: id, sectionIndex, position: ++position });
    }),
  );
  existing.dashboardIds
    .filter((id) => !seen.has(id))
    .forEach((id) => placements.push({ dashboardId: id, sectionIndex: null, position: ++position }));

  const renames = draft.dashboards.map((d) => {
    if (!dashboardIds.has(d.id)) throw new LayoutError("Dashboard desconhecido neste espaço.");
    return { id: d.id, name: d.name, description: d.description === "" ? null : d.description };
  });

  return {
    sections: draft.sections.map((s, i) => ({ id: s.id, title: s.title, position: i + 1 })),
    deleteSectionIds: existing.sectionIds.filter((id) => !usedSections.has(id)),
    placements,
    renames,
  };
}

/** "Atualizado em …" of the dashboard open in the space, for the top of the sidebar; null when none. */
export function updatedLine(toc: readonly TocGroup[], currentId: string | null): string | null {
  const item = toc.flatMap((g) => g.items).find((i) => i.id === currentId);
  return item?.publishedAt ? `Atualizado em ${formatDateShort(item.publishedAt)}` : null;
}
