import Link from "next/link";
import {
  ORG_SCOPE,
  type SpaceDashboard,
  type SpaceGroup,
  type TableProgress,
} from "@/lib/admin-setup";
import type { PickerItem } from "@/lib/catalog-picker";
import type { OrgPerson } from "@/lib/data/organizations";
import { formatDateLong } from "@/lib/format";
import { ClientNameEditor } from "./ClientNameEditor";
import { UnlinkDashboardButton } from "./DashboardLinkForms";
import { SpaceUsersList, SpaceUsersPanel } from "./SetupPeople";
import {
  AddDashboardButton,
  CatalogPickerProvider,
} from "./catalog-picker/CatalogPicker";
import { ManageUsersModal, NewClientModal } from "./SetupTableControls";

export interface AdminSetupTableProps {
  org: { slug: string; name: string };
  groups: SpaceGroup[];
  people: OrgPerson[];
  /** Published catalog dashboards, browsed in the "+ Adicionar dashboard" picker. */
  catalog: PickerItem[];
}

const TH = "px-4 py-3 text-left text-xs font-medium text-muted";
const TD = "px-4 py-3 align-top";
// Sticky cells need an opaque background, and draw their dividing line as a shadow (collapsed
// table borders don't move with sticky cells).
const STICKY_TOP = "sticky top-0 z-20 bg-card shadow-[inset_0_-1px_0_var(--color-line)]";
const STICKY_BOTTOM = "sticky bottom-0 z-20 bg-card shadow-[inset_0_2px_0_var(--color-line),0_-6px_12px_-8px_rgb(0_0_0/0.25)]";

const SUBTLE_LINK = "text-xs text-muted hover:text-brand-2";

function dataStatus(d: SpaceDashboard): { label: string; tone: string } {
  if (d.hasDraft)
    return {
      label: "Arquivos novos aguardando publicação",
      tone: "text-accent",
    };
  if (d.published)
    return {
      label: `Publicado em ${formatDateLong(d.publishedAt)}`,
      tone: "text-ok",
    };
  return { label: "Ainda sem dados publicados", tone: "text-muted" };
}

/** "Fatos 1/1": how many tables of a kind already have a file, out of how many the dashboard needs. */
function TableMeter({
  label,
  part,
}: {
  label: string;
  part: TableProgress["fact"];
}) {
  if (part.required === 0) return null;
  const done = part.sent >= part.required;
  const pct = Math.round((part.sent / part.required) * 100);
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <span
        className="h-1.5 w-16 overflow-hidden rounded-full bg-line"
        aria-hidden
      >
        <span
          className={`block h-full rounded-full ${done ? "bg-ok" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={`tabular-nums font-medium ${done ? "text-ok" : "text-text"}`}
      >
        {part.sent}/{part.required}
      </span>
    </span>
  );
}

function GearIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** Column 1: the space (organization or client), with its address and a gear to edit its theme. */
function SpaceCell({
  org,
  group,
  rowSpan,
}: {
  org: AdminSetupTableProps["org"];
  group: SpaceGroup;
  rowSpan: number;
}) {
  const isOrg = group.scope === ORG_SCOPE;
  const path = isOrg ? `/${org.slug}` : `/${org.slug}/${group.slug}`;
  // Opens the theme form of this space in a centered modal over the table (?tema=org | <client slug>).
  const themeHref = `/${org.slug}/admin?tema=${group.slug ?? "org"}`;
  const spaceName = isOrg ? org.name : group.name;
  const themeGear = (
    <Link
      href={themeHref}
      scroll={false}
      title={`Editar o tema de ${spaceName}`}
      aria-label={`Editar o tema de ${spaceName}`}
      className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-text/5 hover:text-text"
    >
      <GearIcon />
    </Link>
  );
  return (
    <td
      rowSpan={rowSpan}
      className={`${TD} border-r border-line/60 bg-bg-2/40`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {isOrg ? "Organização" : "Cliente"}
      </p>
      {isOrg ? (
        <div className="flex items-center gap-1.5">
          <Link href={path} className="font-semibold hover:text-brand-2">
            {org.name}
          </Link>
          {themeGear}
        </div>
      ) : (
        <ClientNameEditor orgSlug={org.slug} clientId={group.scope} name={group.name} slug={group.slug ?? ""}>
          {themeGear}
        </ClientNameEditor>
      )}
      <p className="font-mono text-[11px] text-muted">dbi.app.br{path}</p>
      <p className="mt-1 text-xs text-muted">
        {group.dashboards.length}{" "}
        {group.dashboards.length === 1 ? "dashboard" : "dashboards"}
      </p>
    </td>
  );
}

/** Column 2: one dashboard of the space. */
function DashboardCell({ orgSlug, d }: { orgSlug: string; d: SpaceDashboard }) {
  return (
    <td className={TD}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{d.name}</p>
        <UnlinkDashboardButton
          orgSlug={orgSlug}
          instanceId={d.instanceId}
          name={d.name}
          compact
        />
      </div>
      {d.published ? (
        <Link
          href={`/${orgSlug}/d/${d.instanceId}`}
          className="text-xs text-brand-2 hover:underline"
        >
          Ver dashboard →
        </Link>
      ) : (
        <p className="text-xs text-muted">Ainda não publicado</p>
      )}
    </td>
  );
}

/** Column 3: how many fact and dimension tables have a file, out of what the dashboard needs. A click opens its data. */
function DataCell({ orgSlug, d }: { orgSlug: string; d: SpaceDashboard }) {
  const st = dataStatus(d);
  return (
    <td className={TD}>
      <Link
        href={`/${orgSlug}/admin?dados=${d.instanceId}`}
        scroll={false}
        title="Abrir os dados deste dashboard"
        className="-mx-2 -my-1 flex flex-col gap-1 rounded-lg px-2 py-1 hover:bg-text/5"
      >
        {d.tables ? (
          <>
            <TableMeter label="Fatos" part={d.tables.fact} />
            <TableMeter label="Dimensões" part={d.tables.dimension} />
          </>
        ) : (
          <span className="text-xs text-muted">
            Contrato de dados indisponível
          </span>
        )}
        <span className={`text-[11px] ${st.tone}`}>{st.label}</span>
      </Link>
    </td>
  );
}

/** Column 4: who sees the space (access is per space, so it spans all of its dashboards). */
function AccessCell({
  group,
  people,
  rowSpan,
}: {
  group: SpaceGroup;
  people: OrgPerson[];
  rowSpan: number;
}) {
  return (
    <td rowSpan={rowSpan} className={`${TD} border-l border-line/60`}>
      <SpaceUsersList scope={group.scope} people={people} />
    </td>
  );
}

function SpaceBlock({
  org,
  group,
  people,
}: {
  org: AdminSetupTableProps["org"];
  group: SpaceGroup;
  people: OrgPerson[];
}) {
  const n = group.dashboards.length;
  const spaceName = group.scope === ORG_SCOPE ? org.name : group.name;
  const named = { ...group, name: spaceName };
  const firstDashboard = group.dashboards[0];
  return (
    <tbody className="border-t-2 border-line">
      {group.dashboards.map((d, i) => (
        <tr key={d.instanceId} className="border-b border-line/40">
          {i === 0 && <SpaceCell org={org} group={group} rowSpan={n + 1} />}
          <DashboardCell orgSlug={org.slug} d={d} />
          <DataCell orgSlug={org.slug} d={d} />
          {i === 0 && <AccessCell group={named} people={people} rowSpan={n} />}
        </tr>
      ))}
      {/* Last row of the block: one action per column, side by side. */}
      <tr>
        {n === 0 && <SpaceCell org={org} group={group} rowSpan={1} />}
        <td className={TD}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <AddDashboardButton
              scope={group.scope}
              spaceName={spaceName}
              linkedIds={group.dashboards.map((d) => d.templateId)}
            />
            {n > 0 && (
              <Link
                href={`/${org.slug}/admin?sumario=${group.slug ?? "org"}`}
                scroll={false}
                title="Seções e ordem dos dashboards na barra lateral"
                className={SUBTLE_LINK}
              >
                Organizar sumário →
              </Link>
            )}
          </div>
        </td>
        <td className={TD}>
          {firstDashboard ? (
            <Link
              href={`/${org.slug}/admin?dados=${firstDashboard.instanceId}`}
              scroll={false}
              className={SUBTLE_LINK}
            >
              Gerenciar dados →
            </Link>
          ) : (
            <span className="text-xs text-muted">
              Escolha um dashboard para subir os dados.
            </span>
          )}
        </td>
        <td className={`${TD} border-l border-line/60`}>
          {n === 0 && (
            <div className="mb-2">
              <SpaceUsersList scope={group.scope} people={people} />
            </div>
          )}
          <ManageUsersModal spaceName={spaceName}>
            <SpaceUsersPanel
              org={org.slug}
              scope={group.scope}
              spaceName={spaceName}
              people={people}
            />
          </ManageUsersModal>
        </td>
      </tr>
    </tbody>
  );
}

/**
 * The organization's configuration — the only object on /<org>/admin, read left to right as a hierarchy:
 * space (organization, then each client) → its dashboards → the data feeding each one → who sees the space.
 */
export function AdminSetupTable({
  org,
  groups,
  people,
  catalog,
}: AdminSetupTableProps) {
  return (
    <CatalogPickerProvider orgSlug={org.slug} items={catalog}>
      {/*
        Scrolls inside its own box (both ways), sized to the screen: the column names stay on top and the
        "+ Adicionar cliente" row stays at the bottom, however many clients there are.
      */}
      <div className="card max-h-[calc(100vh-8.5rem)] overflow-auto">
        <table className="w-full min-w-[880px] table-fixed border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${TH} ${STICKY_TOP} w-[24%]`}>1 · Cliente / organização</th>
              <th className={`${TH} ${STICKY_TOP} w-[26%]`}>2 · Dashboard</th>
              <th className={`${TH} ${STICKY_TOP} w-[26%]`}>3 · Dados</th>
              <th className={`${TH} ${STICKY_TOP} w-[24%]`}>4 · Acessos</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <SpaceBlock key={g.scope} org={org} group={g} people={people} />
          ))}
          <tbody>
            <tr>
              <td className={`${TD} ${STICKY_BOTTOM}`}>
                <NewClientModal orgSlug={org.slug} />
              </td>
              <td colSpan={3} className={STICKY_BOTTOM} />
            </tr>
          </tbody>
        </table>
      </div>
    </CatalogPickerProvider>
  );
}
