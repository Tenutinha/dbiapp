import { requireSpaceAction } from "@/lib/access";
import { AccessError } from "@/lib/auth";
import { getEffectiveBranding, getSpaceBranding } from "@/lib/data/branding";
import { DEFAULT_THEME } from "@/lib/theme/theme";
import { RouteModal } from "./RouteModal";
import { ThemeForm } from "./ThemeForm";

interface ThemeModalProps {
  orgSlug: string;
  orgName: string;
  /** "org" for the organization, otherwise the client's slug (?tema=…). */
  space: string;
  /** Every space of the organization, to switch between them in the modal. */
  spaces: { slug: string | null; name: string }[];
}

/**
 * The theme (colours, logo, light/dark) of one space in a centered modal over the admin table,
 * opened by ?tema=<org | client slug>. An unknown space or a non-admin just gets no modal.
 */
export async function ThemeModal({ orgSlug, orgName, space, spaces }: ThemeModalProps) {
  const clientSlug = space === "org" ? null : space;
  let loaded;
  try {
    const access = await requireSpaceAction(orgSlug, clientSlug, "admin");
    const [own, orgEffective] = await Promise.all([
      getSpaceBranding(access.space.orgId, access.space.clientId),
      getEffectiveBranding(access.space.orgId, null),
    ]);
    loaded = { access, own, orgEffective };
  } catch (err) {
    if (err instanceof AccessError) return null;
    throw err;
  }

  const { access, own, orgEffective } = loaded;
  const isClient = access.client !== null;
  const spaceName = access.client?.name ?? orgName;

  return (
    <RouteModal
      closeHref={`/${orgSlug}/admin`}
      eyebrow={`Tema · ${isClient ? "Cliente" : "Organização"}`}
      title={spaceName}
      subtitle={
        isClient
          ? `O que não for definido aqui segue o tema de ${orgName}.`
          : "Vale para a organização e para todos os clientes que não tiverem tema próprio."
      }
      tabs={spaces.map((s) => ({
        href: `/${orgSlug}/admin?tema=${s.slug ?? "org"}`,
        label: s.name,
        active: s.slug === clientSlug,
      }))}
      tabsLabel="Espaços"
      width={1100}
    >
      <ThemeForm
        key={clientSlug ?? "org"}
        orgSlug={orgSlug}
        clientSlug={clientSlug}
        spaceName={spaceName}
        input={own.input}
        inherited={isClient ? orgEffective.theme : DEFAULT_THEME}
        inheritedLabel={isClient ? orgName : "o padrão DBI"}
        logoUrl={own.logoUrl}
        inheritedLogoUrl={isClient ? orgEffective.logoUrl : null}
      />
    </RouteModal>
  );
}
