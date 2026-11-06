import type { Metadata } from "next";
import { Logo } from "@/components/AppShell";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-4">
      <Logo />
      <div>
        <h1 className="font-serif text-4xl">Entrar</h1>
        <p className="mt-2 text-sm text-muted">Enviamos um link de acesso para o seu e-mail. Sem senha.</p>
      </div>
      {erro && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          O link expirou ou já foi usado. Peça um novo.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
