import { requireSpaceAction } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { getSpaceLayout } from "@/lib/data/layout";
import { buildToc } from "@/lib/layout/toc";
import { RouteModal } from "./RouteModal";
import { SummaryEditorPanel } from "./SummaryEditorPanel";

interface SummaryModalProps {
  orgSlug: string;
  orgName: string;
  /** "org" for the organization, otherwise the client's slug (?sumario=…). */
  space: string;
  /** Every space of the organization, to switch between them in the modal. */
  spaces: { slug: string | null; name: string }[];
}

/**
 * "Organizar sumário" of one space — sections and the order of its dashboards in the dashboard screen's
 * sidebar — in a centered modal over the admin table (?sumario=<org | client slug>). Admins only.
 */
export async function SummaryModal({ orgSlug, orgName, space, spaces }: SummaryModalProps) {
  const clientSlug = space === "org" ? null : space;
  let loaded;
  try {
    const access = await requireSpaceAction(orgSlug, clientSlug, "admin");
    const layout = await getSpaceLayout(
      { orgId: access.space.orgId, clientId: access.space.clientId },
      { platformAdmin: access.ctx.membership.platformAdmin === true },
    );
    loaded = { access, toc: buildToc(layout.sections, layout.dashboards, { includeUnpublished: true, includeEmptySections: true }) };
  } catch (err) {
    if (err instanceof AccessError) return null;
    throw err;
  }

  const spaceName = loaded.access.client?.name ?? orgName;
  const closeHref = `/${orgSlug}/admin`;
  return (
    <RouteModal
      closeHref={closeHref}
      eyebrow={`Sumário · ${loaded.access.client ? "Cliente" : "Organização"}`}
      title={spaceName}
      subtitle="Seções e ordem dos dashboards na barra lateral da tela do dashboard. Arraste para reordenar."
      tabs={spaces.map((s) => ({
        href: `/${orgSlug}/admin?sumario=${s.slug ?? "org"}`,
        label: s.name,
        active: s.slug === clientSlug,
      }))}
      tabsLabel="Espaços"
      width={640}
    >
      <SummaryEditorPanel key={clientSlug ?? "org"} orgSlug={orgSlug} clientSlug={clientSlug} toc={loaded.toc} closeHref={closeHref} />
    </RouteModal>
  );
}
