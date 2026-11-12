/**
 * Where a catalog dashboard is used, in words for the showcase card and its deletion tab. Pure: the
 * rows come from listCatalog (lib/data/catalog.ts).
 */
export interface TemplateUseView {
  org: string;
  /** Null for the organization's own space. */
  client: string | null;
  dashboard: string;
  archived: boolean;
}

/** "Martinello (Davos)" — or just the organization for its own space. */
export const placeOf = (u: TemplateUseView): string => (u.client ? `${u.client} (${u.org})` : u.org);

/** Places in use, distinct and in order, at most `max` then "+N". Empty when nothing in use. */
export function inUseLabel(uses: readonly TemplateUseView[], max = 2): string {
  const places = [...new Set(uses.filter((u) => !u.archived).map(placeOf))];
  if (places.length <= max) return places.join(", ");
  return `${places.slice(0, max).join(", ")} +${places.length - max}`;
}

export const archivedCount = (uses: readonly TemplateUseView[]): number => uses.filter((u) => u.archived).length;
