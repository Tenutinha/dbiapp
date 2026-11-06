import Link from "next/link";
import type { SpaceView } from "@/lib/services/space";
import { SidebarNav } from "./SidebarNav";
import { SidebarShell } from "./SidebarShell";
import { ThemeScope } from "./ThemeScope";

interface WorkspaceProps {
  space: SpaceView;
  currentId: string | null;
  userName: string;
  children: React.ReactNode;
}

/** Two-pane layout: light table of contents on the left, the dashboard on the right. */
export function Workspace({ space, currentId, userName, children }: WorkspaceProps) {
  const { org, client, links } = space;
  const canManage = space.actions.has("manageData");
  const catalogHref = `/${org.slug}/catalogo${client ? `?para=${client.slug}` : ""}`;

  const footer = (
    <div className="flex flex-col gap-3">
      {canManage && (
        <Link href={catalogHref} className="text-ink underline-offset-4 hover:underline">+ Adicionar dashboard</Link>
      )}
      {(links.org || links.clients.length > 0) && (
        <details className="group">
          <summary className="cursor-pointer list-none text-ink-muted hover:text-ink">
            Outros espaços <span className="inline-block transition group-open:rotate-90">›</span>
          </summary>
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {links.org && <li><Link href={links.org.href} className="hover:underline">{links.org.label}</Link></li>}
            {links.clients.map((c) => (
              <li key={c.href}><Link href={c.href} className="hover:underline">{c.label}</Link></li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex items-center justify-between gap-2 text-[13px] text-ink-muted">
        <span className="truncate">{userName}</span>
        {space.isOrgAdmin && <Link href={`/${org.slug}/admin`} className="shrink-0 hover:text-ink hover:underline">Administração</Link>}
      </div>
    </div>
  );

  return (
    <ThemeScope theme={space.theme}>
      <SidebarShell
        title={client?.name ?? org.name}
        subtitle={client ? org.name : null}
        logoUrl={space.logoUrl}
        orgSlug={org.slug}
        clientSlug={client?.slug ?? null}
        editorToc={space.editorToc}
        footer={footer}
      >
        <SidebarNav orgSlug={org.slug} toc={space.toc} currentId={currentId} canManage={canManage} />
      </SidebarShell>
      <main className="px-4 pb-16 sm:px-8 lg:ml-[300px] lg:px-14">
        <div className="mx-auto max-w-[1180px]">{children}</div>
      </main>
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
