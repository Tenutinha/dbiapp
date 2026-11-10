import Link from "next/link";
import type { SpaceView } from "@/lib/services/space";
import type { SummaryItem } from "@/lib/templates/sections";
import { SignOutButton } from "../SignOutButton";
import { SidebarNav } from "./SidebarNav";
import { DbiLogo, SidebarShell } from "./SidebarShell";
import { ThemeScope } from "./ThemeScope";

interface WorkspaceProps {
  space: SpaceView;
  currentId: string | null;
  userName: string;
  /** Analyses of the open dashboard, nested under its name in the sidebar. */
  outline?: SummaryItem[];
  children: React.ReactNode;
}

/** Two-pane layout: light table of contents on the left, the dashboard on the right. */
export function Workspace({ space, currentId, userName, outline = [], children }: WorkspaceProps) {
  const { org, client } = space;
  // The organization's own page is linked only when this person can open it (client users may not).
  const orgHref = space.spaces.some((s) => s.kind === "org") ? `/${org.slug}` : null;

  // Other spaces are in the switcher at the top; the footer keeps who is signed in, the admin links,
  // and the DBI logo (back to the platform's home) next to "Sair".
  const footer = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-[13px] text-ink-muted">
        <span className="truncate">{userName}</span>
        {space.isOrgAdmin && (
          <Link href={`/${org.slug}/admin`} className="shrink-0 hover:text-ink hover:underline">Administração</Link>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Link href="/" aria-label="DBI — voltar à tela inicial" title="Voltar à tela inicial" className="rounded-md hover:opacity-80">
          <DbiLogo />
        </Link>
        <SignOutButton className="text-[13px] text-ink-muted hover:text-ink hover:underline" />
      </div>
    </div>
  );

  return (
    <ThemeScope theme={space.theme}>
      <SidebarShell
        title={client?.name ?? org.name}
        org={{ name: org.name, href: orgHref }}
        spaces={space.spaces}
        logoUrl={space.logoUrl}
        orgSlug={org.slug}
        clientSlug={client?.slug ?? null}
        footer={footer}
        content={<div className="mx-auto max-w-[1180px]">{children}</div>}
      >
        <SidebarNav toc={space.toc} currentId={currentId} outline={outline} />
      </SidebarShell>
    </ThemeScope>
  );
}

interface MainHeaderProps {
  kicker: string;
  meta?: string;
  title: string;
  lead?: string | null;
  links?: { href: string; label: string; active?: boolean }[];
}

/** Editorial header: kicker / meta line, large serif title, lead paragraph, a few quiet text links. */
export function MainHeader({ kicker, meta, title, lead, links = [] }: MainHeaderProps) {
  return (
    <header className="pb-10 pt-8 lg:pt-14">
      <div className="flex flex-col gap-1 border-b border-line pb-4 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <span className="truncate">{kicker}</span>
        {meta && <span className="text-muted sm:shrink-0">{meta}</span>}
      </div>
      <h1 className="mt-8 font-serif text-[clamp(2.6rem,6.5vw,5.75rem)] font-normal leading-[1.02] tracking-[-0.02em]">{title}</h1>
      {lead && <p className="mt-6 max-w-3xl text-lg leading-relaxed text-text/75 sm:text-xl">{lead}</p>}
      {links.length > 0 && (
        <nav className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Ações do dashboard">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={l.active ? "page" : undefined}
              className={l.active ? "text-text underline underline-offset-4" : "text-muted hover:text-text"}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
