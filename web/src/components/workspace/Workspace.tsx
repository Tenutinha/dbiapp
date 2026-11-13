import Link from "next/link";
import { getCurrentUser, supabaseAuthEnabled } from "@/lib/auth";
import { avatarUrl } from "@/lib/data/users";
import type { SpaceView } from "@/lib/services/space";
import { UserMenu, type UserMenuLink } from "../user-menu/UserMenu";
import { SidebarNav, type Notes, type Outlines } from "./SidebarNav";
import { DbiLogo, SidebarShell } from "./SidebarShell";
import { ThemeScope } from "./ThemeScope";

interface WorkspaceProps {
  space: SpaceView;
  currentId: string | null;
  userName: string;
  /** Analyses of each dashboard, nested under its name in the sidebar. */
  outlines?: Outlines;
  /** What each dashboard is about: shown as a note when the mouse rests on it in the sidebar. */
  notes?: Notes;
  /** Full-width bar on top of the content area (the dashboard header), outside the centred column. */
  top?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The signed-in person's avatar and its menu ("Administração" for the organization's admins, "Meu perfil",
 * theme, "Sair"). Null when there is no session to show. getCurrentUser is cached per request.
 */
async function accountMenu(space: SpaceView, userName: string): Promise<React.ReactNode> {
  try {
    const user = await getCurrentUser();
    const links: UserMenuLink[] = space.isOrgAdmin ? [{ label: "Administração", href: `/${space.org.slug}/admin` }] : [];
    return (
      <UserMenu
        name={userName}
        email={user.email}
        avatarUrl={avatarUrl(user.avatarKey)}
        links={links}
        authEnabled={supabaseAuthEnabled()}
      />
    );
  } catch {
    return null;
  }
}

/** Two-pane layout: light table of contents on the left, the dashboard on the right. */
export async function Workspace({ space, currentId, userName, outlines = {}, notes = {}, top, children }: WorkspaceProps) {
  const { org, client } = space;
  // The organization's own page is linked only when this person can open it (client users may not).
  const orgHref = space.spaces.some((s) => s.kind === "org") ? `/${org.slug}` : null;

  // Other spaces are in the switcher at the top; the footer keeps only the DBI logo (back to the platform's
  // home). Who is signed in, the administration and "Sair" are in the avatar at the right of the header.
  const footer = (
    <Link href="/" aria-label="DBI — voltar à tela inicial" title="Voltar à tela inicial" className="inline-flex rounded-md hover:opacity-80">
      <DbiLogo />
    </Link>
  );
  const account = await accountMenu(space, userName);

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
        account={account}
        content={
          <>
            {/* No header on this screen: the avatar keeps its corner, at the top right of the page. */}
            {top ?? (account && <div className="flex justify-end pt-4">{account}</div>)}
            <div className="mx-auto max-w-[1180px]">{children}</div>
          </>
        }
      >
        <SidebarNav toc={space.toc} currentId={currentId} outlines={outlines} notes={notes} />
      </SidebarShell>
    </ThemeScope>
  );
}

interface MainHeaderProps {
  /** Line above the title (organization · space). Left out where the sidebar already says it. */
  kicker?: string;
  meta?: string;
  title: string;
  lead?: string | null;
  links?: { href: string; label: string; active?: boolean }[];
}

/** Editorial header: kicker / meta line, serif title, lead paragraph, a few quiet text links. */
export function MainHeader({ kicker, meta, title, lead, links = [] }: MainHeaderProps) {
  const topLine = Boolean(kicker || meta);
  return (
    <header className={topLine ? "pb-6 pt-6 lg:pt-8" : "pb-5 pt-5 lg:pt-6"}>
      {topLine && (
        <div className="mb-5 flex flex-col gap-1 border-b border-line pb-4 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          {kicker && <span className="truncate">{kicker}</span>}
          {meta && <span className="text-muted sm:shrink-0">{meta}</span>}
        </div>
      )}
      <h1 className="font-serif text-[clamp(2rem,3.6vw,3rem)] font-normal leading-[1.05] tracking-[-0.02em]">{title}</h1>
      {lead && <p className="mt-4 max-w-3xl leading-relaxed text-text/75">{lead}</p>}
      {links.length > 0 && (
        <nav className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Ações do dashboard">
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
