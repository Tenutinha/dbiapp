import { signOutAction } from "@/app/entrar/actions";
import { supabaseAuthEnabled } from "@/lib/auth";

/** "Sair" — only rendered when real login (Supabase Auth) is on. */
export function SignOutButton({ className = "" }: { className?: string }) {
  if (!supabaseAuthEnabled()) return null;
  return (
    <form action={signOutAction} className="inline">
      <button type="submit" className={className}>Sair</button>
    </form>
  );
}
