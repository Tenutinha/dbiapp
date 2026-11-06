import type { Metadata } from "next";
import Link from "next/link";
import { AuthPage } from "../AuthPage";
import { ResetForm } from "./ResetForm";

export const metadata: Metadata = { title: "Recuperar senha" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ primeiro?: string }> }) {
  const { primeiro } = await searchParams;
  const first = primeiro === "1";
  return (
    <AuthPage
      title={first ? "Criar senha" : "Recuperar senha"}
      subtitle={
        first
          ? "Digite o e-mail em que você foi convidado. Enviaremos um link para você criar sua senha."
          : "Digite seu e-mail. Enviaremos um link para você criar uma nova senha."
      }
    >
      <ResetForm />
      <p className="text-center text-sm text-muted">
        <Link href="/entrar" className="text-text underline underline-offset-4 hover:text-brand">Voltar para o login</Link>
      </p>
    </AuthPage>
  );
}
