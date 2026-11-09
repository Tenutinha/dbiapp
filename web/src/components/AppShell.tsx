import Link from "next/link";
import { getCurrentUser, supabaseAuthEnabled, type CurrentUser } from "@/lib/auth";
import { avatarUrl } from "@/lib/data/users";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu, type UserMenuLink } from "./user-menu/UserMenu";

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-2" aria-hidden>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round">
          <path d="M5 20V10M12 20V4M19 20v-7" />
        </svg>
      </span>
      DBI
    </span>
  );
}

interface AppHeaderProps {
  org?: { slug: string; name: string };
  isAdmin?: boolean;
  userName?: string;
}

/** The signed-in person, or null (the header then shows the logo). getCurrentUser is cached per request. */
async function signedIn(): Promise<CurrentUser | null> {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

/**
 * Top bar: the DBI logo (home) on the left; signed in, the person's avatar on the right — hovering it opens the menu
 * (this organization and its administration, light/dark theme, "Meu perfil", "Sair").
 */
export async function AppHeader({ org, isAdmin, userName }: AppHeaderProps) {
  const user = userName ? await signedIn() : null;
  const links: UserMenuLink[] = [
    ...(org ? [{ label: org.name, href: `/${org.slug}` }] : []),
    ...(org && isAdmin ? [{ label: `Administração · ${org.name}`, href: `/${org.slug}/admin` }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left: the DBI logo is the way home. */}
        <Link href="/" aria-label="Início" title="Início">
          <Logo />
        </Link>
        {/* Right: the person's avatar and its menu (or just the theme switch when signed out). */}
        {user ? (
          <UserMenu
            name={user.name}
            email={user.email}
            avatarUrl={avatarUrl(user.avatarKey)}
            links={links}
            authEnabled={supabaseAuthEnabled()}
          />
        ) : (
          <ThemeToggle className="grid size-8 place-items-center rounded-lg text-muted hover:bg-text/5 hover:text-text" />
        )}
      </div>
    </header>
  );
}

/** Standard page inside an organization (admin, catalog…): header + centred content. */
export function OrgFrame({ children, ...header }: AppHeaderProps & { children: React.ReactNode }) {
  return (
    <>
      <AppHeader {...header} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}

/** Page container for routes outside an organization layout. */
export function AppShell({ children, userName }: { children: React.ReactNode; userName?: string }) {
  return (
    <>
      <AppHeader userName={userName} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  eyebrow?: string;
  crumbs?: Crumb[];
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, crumbs, title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Caminho" className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>›</span>}
                {c.href ? <Link href={c.href} className="hover:text-text">{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-2">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: React.ReactNode }) {
  const tones = {
    info: "border-brand/40 bg-brand/10 text-text",
    error: "border-danger/40 bg-danger/10 text-danger",
    ok: "border-ok/40 bg-ok/10 text-ok",
  };
  return <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export function Forbidden({ message = "Seu papel não permite acessar esta página." }: { message?: string }) {
  return <Notice tone="error">{message}</Notice>;
}
