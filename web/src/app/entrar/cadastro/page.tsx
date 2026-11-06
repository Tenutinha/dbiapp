import type { Metadata } from "next";
import Link from "next/link";
import { AuthPage } from "../AuthPage";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignupPage() {
  return (
    <AuthPage
      title="Criar conta"
      subtitle="Crie sua conta e a organização da sua empresa. Você será o admin e poderá convidar sua equipe e seus clientes."
    >
      <SignupForm />
      <p className="text-center text-sm text-muted">
        Já tem conta?{" "}
        <Link href="/entrar" className="text-text underline underline-offset-4 hover:text-brand">Entrar</Link>
      </p>
    </AuthPage>
  );
}
