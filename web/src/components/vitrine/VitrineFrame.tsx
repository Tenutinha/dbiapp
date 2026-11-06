import Link from "next/link";
import { AppShell, Logo } from "@/components/AppShell";
import type { VitrineViewer } from "@/lib/vitrine-server";

interface VitrineFrameProps {
  viewer: VitrineViewer | null;
  children: React.ReactNode;
}

/** Signed-in users keep the app header; visitors get a public one with sign-in / sign-up. */
export function VitrineFrame({ viewer, children }: VitrineFrameProps) {
  if (viewer) return <AppShell userName={viewer.user.name}>{children}</AppShell>;
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="DBI, início">
            <Logo />
          </Link>
          <div className="flex gap-2">
            <Link href="/entrar" className="btn btn-ghost">
              Entrar
            </Link>
            <Link href="/entrar/cadastro" className="btn btn-primary hidden sm:inline-flex">
              Criar conta
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
