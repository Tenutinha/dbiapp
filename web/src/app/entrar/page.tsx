import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";
import { AuthPage } from "./AuthPage";
import { Alert } from "./ui";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <AuthPage title="Entrar" subtitle="Use seu e-mail e senha para acessar seus dashboards.">
      {erro && <Alert>O link expirou ou já foi usado. Entre com sua senha ou peça um novo.</Alert>}
      <LoginForm />
    </AuthPage>
  );
}
