import { matchesQuery } from "./text-search";

/** One space a person can open in an organization: the organization itself or one of its clients. */
export interface SpaceOption {
  href: string;
  label: string;
  kind: "org" | "client";
  current: boolean;
  /** The logo this space set for itself (not the one inherited from the organization), or null. */
  logoUrl: string | null;
}

/** Logo address of each space that has its own, by client id (null = the organization itself). */
export type SpaceLogos = ReadonlyMap<string | null, string>;

const NO_LOGOS: SpaceLogos = new Map();

/**
 * The sidebar's client switcher: the organization (when this person can view it, or is on it) and the
 * clients they can see, with the current one marked. One entry means there is nothing to switch to.
 */
export function spaceOptions(
  org: { slug: string; name: string },
  currentClientId: string | null,
  canViewOrg: boolean,
  clients: readonly { id: string; slug: string; name: string }[],
  logos: SpaceLogos = NO_LOGOS,
): SpaceOption[] {
  return [
    ...(canViewOrg || currentClientId === null
      ? [{
          href: `/${org.slug}`,
          label: org.name,
          kind: "org" as const,
          current: currentClientId === null,
          logoUrl: logos.get(null) ?? null,
        }]
      : []),
    ...clients.map((c) => ({
      href: `/${org.slug}/${c.slug}`,
      label: c.name,
      kind: "client" as const,
      current: c.id === currentClientId,
      logoUrl: logos.get(c.id) ?? null,
    })),
  ];
}


/** The switcher's search: spaces whose name contains the query (accent- and case-insensitive), in order. */
export function filterSpaces(spaces: readonly SpaceOption[], query: string): SpaceOption[] {
  return spaces.filter((s) => matchesQuery(s.label, query));
}

/**
 * The organizations a person can open, for the switcher on the organization's name in the sidebar (each
 * opens on its own page, which takes them to the last space they used there). One entry = nothing to switch.
 */
export function orgOptions(
  orgs: readonly { id: string; slug: string; name: string }[],
  currentSlug: string,
  /** Logo address of each organization that has one, by organization id. */
  logos: ReadonlyMap<string, string> = new Map(),
): SpaceOption[] {
  return orgs.map((o) => ({
    href: `/${o.slug}`,
    label: o.name,
    kind: "org" as const,
    current: o.slug === currentSlug,
    logoUrl: logos.get(o.id) ?? null,
  }));
}
