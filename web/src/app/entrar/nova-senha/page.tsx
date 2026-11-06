import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseAuthEnabled } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { AuthPage } from "../AuthPage";
import { NewPasswordForm } from "./NewPasswordForm";

export const metadata: Metadata = { title: "Nova senha" };
export const dynamic = "force-dynamic";

/** Reached from the reset e-mail (the link already signed the person in) or while logged in. */
export default async function NewPasswordPage() {
  if (supabaseAuthEnabled()) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    if (!data.user) redirect("/entrar?erro=1");
  }
  return (
    <AuthPage title="Nova senha" subtitle="Escolha a senha que você vai usar para entrar na DBI.">
      <NewPasswordForm />
    </AuthPage>
  );
}
