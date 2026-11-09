import { revokeAccessAction } from "@/app/[org]/admin/actions";
import { ORG_SCOPE } from "@/lib/admin-setup";
import type { OrgPerson } from "@/lib/data/organizations";
import { ROLE_LABEL } from "@/lib/permissions";
import { GrantAccessForm } from "./AdminForms";
import { avatarUrl } from "@/lib/data/users";
import { Avatar } from "./Avatar";

interface RevokeButtonProps {
  org: string;
  userId: string;
  /** Absent = removes the person from the organization's staff. */
  clientId?: string;
  label: string;
}

export function RevokeButton({ org, userId, clientId, label }: RevokeButtonProps) {
  return (
    <form action={revokeAccessAction} className="inline">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="userId" value={userId} />
      {clientId && <input type="hidden" name="clientId" value={clientId} />}
      <button type="submit" title={label} aria-label={label} className="ml-1 text-muted hover:text-danger">×</button>
    </form>
  );
}

interface Viewer {
  person: OrgPerson;
  role: string;
  /** "staff" = comes from the organization's team; "client" = a user of this client. */
  via: "staff" | "client";
}

/** Who sees a space: the whole staff for the organization; admins, editors and the client's users for a client. */
export function viewersOf(scope: string, people: readonly OrgPerson[]): Viewer[] {
  if (scope === ORG_SCOPE) {
    return people.flatMap((p) => (p.orgRole ? [{ person: p, role: ROLE_LABEL[p.orgRole], via: "staff" as const }] : []));
  }
  return people.flatMap((p): Viewer[] => {
    const own = p.clients.find((c) => c.clientId === scope);
    if (own) return [{ person: p, role: ROLE_LABEL[own.role], via: "client" }];
    if (p.orgRole === "admin" || p.orgRole === "editor") return [{ person: p, role: ROLE_LABEL[p.orgRole], via: "staff" }];
    return [];
  });
}

interface SpaceUsersProps {
  org: string;
  scope: string;
  spaceName: string;
  people: readonly OrgPerson[];
}

const MAX_AVATARS = 6;

/**
 * Column "Acessos": the people who see this space as one row of overlapping avatars (+N beyond six)
 * and a single truncated line of first names — never taller than two lines, however many people.
 * Hover an avatar for name and role; the full list is in "Gerenciar usuários".
 */
export function SpaceUsersList({ scope, people }: Pick<SpaceUsersProps, "scope" | "people">) {
  const viewers = viewersOf(scope, people);
  if (viewers.length === 0) return <p className="text-xs text-muted">Ninguém com acesso ainda.</p>;
  const shown = viewers.slice(0, MAX_AVATARS);
  const rest = viewers.length - shown.length;
  const label = (v: Viewer): string =>
    `${v.person.name} · ${v.role}${v.via === "staff" && scope !== ORG_SCOPE ? " (equipe)" : ""}`;
  return (
    <div className="min-w-0">
      <div className="flex items-center">
        <div className="flex -space-x-2">
          {shown.map((v) => <Avatar key={v.person.userId} name={v.person.name} email={v.person.email} imageUrl={avatarUrl(v.person.avatarKey)} title={label(v)} />)}
        </div>
        {rest > 0 && (
          <span
            className="ml-1 inline-grid size-7 place-items-center rounded-full bg-line text-[10px] font-semibold text-muted"
            title={viewers.slice(MAX_AVATARS).map(label).join("\n")}
          >
            +{rest}
          </span>
        )}
        <span className="ml-2 text-xs text-muted">{viewers.length} {viewers.length === 1 ? "pessoa" : "pessoas"}</span>
      </div>
      <p className="mt-1 truncate text-[11px] text-muted" title={viewers.map(label).join("\n")}>
        {viewers.map((v) => v.person.name.split(/\s+/)[0]).join(", ")}
      </p>
    </div>
  );
}

/** Content of the "Gerenciar usuários" modal: everyone who sees the space (× to revoke) and the access form. */
export function SpaceUsersPanel({ org, scope, spaceName, people }: SpaceUsersProps) {
  const viewers = viewersOf(scope, people);
  const isOrg = scope === ORG_SCOPE;
  return (
    <div className="card flex flex-col gap-5 p-5">
      <section>
        <h3 className="font-semibold">Quem vê {spaceName}</h3>
        <p className="mb-3 text-xs text-muted">
          {isOrg
            ? "A equipe da organização. O acesso vale para todos os dashboards publicados deste espaço."
            : "Os usuários deste cliente, mais admins e editores da organização (marcados “equipe”)."}
        </p>
        {viewers.length === 0 && <p className="text-sm text-muted">Ninguém ainda.</p>}
        <ul className="divide-y divide-line rounded-lg border border-line">
          {viewers.map(({ person, role, via }) => (
            <li key={person.userId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <Avatar name={person.name} email={person.email} imageUrl={avatarUrl(person.avatarKey)} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{person.name}</span>
                <span className="block truncate text-xs text-muted">
                  {person.email} · {role}{via === "staff" && !isOrg ? " (equipe)" : ""}
                </span>
              </span>
              {isOrg && <RevokeButton org={org} userId={person.userId} label={`Tirar ${person.name} da equipe da organização`} />}
              {!isOrg && via === "client" && (
                <RevokeButton org={org} userId={person.userId} clientId={scope} label={`Tirar ${person.name} de ${spaceName}`} />
              )}
              {!isOrg && via === "staff" && <span className="shrink-0 text-xs text-muted">pela equipe</span>}
            </li>
          ))}
        </ul>
      </section>
      <section className="border-t border-line pt-4">
        <GrantAccessForm
          orgSlug={org}
          clients={isOrg ? [] : [{ id: scope, name: spaceName }]}
          allowOrg={isOrg}
          title="Dar acesso a mais alguém"
          bare
        />
      </section>
    </div>
  );
}
