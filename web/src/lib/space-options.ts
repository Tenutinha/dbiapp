import { matchesQuery } from "./text-search";

/** One space a person can open in an organization: the organization itself or one of its clients. */
export interface SpaceOption {
  href: string;
  label: string;
  kind: "org" | "client";
  current: boolean;
}

/**
 * The sidebar's client switcher: the organization (when this person can view it, or is on it) and the
 * clients they can see, with the current one marked. One entry means there is nothing to switch to.
 */
export function spaceOptions(
  org: { slug: string; name: string },
  currentClientId: string | null,
  canViewOrg: boolean,
  clients: readonly { id: string; slug: string; name: string }[],
): SpaceOption[] {
  return [
    ...(canViewOrg || currentClientId === null
      ? [{ href: `/${org.slug}`, label: org.name, kind: "org" as const, current: currentClientId === null }]
      : []),
    ...clients.map((c) => ({
      href: `/${org.slug}/${c.slug}`,
      label: c.name,
      kind: "client" as const,
      current: c.id === currentClientId,
    })),
  ];
}


/** The switcher's search: spaces whose name contains the query (accent- and case-insensitive), in order. */
export function filterSpaces(spaces: readonly SpaceOption[], query: string): SpaceOption[] {
  return spaces.filter((s) => matchesQuery(s.label, query));
}
