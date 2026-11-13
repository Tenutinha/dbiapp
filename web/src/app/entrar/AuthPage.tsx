import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/AppShell";

/** Page frame of the login, reset and new-password screens (Server Component). */
interface AuthPageProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthPage({ title, subtitle, children }: AuthPageProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-4">
      <Link href="/" aria-label="Início" className="w-fit">
        <Logo tagline />
      </Link>
      <div>
        <h1 className="font-serif text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">{subtitle}</p>
      </div>
      {children}
    </main>
  );
}
