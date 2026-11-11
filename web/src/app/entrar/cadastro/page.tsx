import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_HREF } from "@/components/landing/content";
import { AuthPage } from "../AuthPage";

export const metadata: Metadata = { title: "Acesso por convite" };

/**
 * Self-service signup is closed: organizations are created only by platform administrators
 * ("admin master"), and people join by invitation. The old address stays to explain that.
 */
export default function SignupPage() {
  return (
    <AuthPage
      title="Acesso por convite"
      subtitle="As organizações da DBI são criadas pela nossa equipe. Se a sua empresa já usa a DBI, peça ao admin dela para te convidar."
    >
      <a href={CONTACT_HREF} className="btn btn-primary w-full">Quero conhecer a DBI</a>
      <p className="text-center text-sm text-muted">
        Já tem conta ou recebeu um convite?{" "}
        <Link href="/entrar" className="text-text underline underline-offset-4 hover:text-brand">Entrar</Link>
      </p>
    </AuthPage>
  );
}
