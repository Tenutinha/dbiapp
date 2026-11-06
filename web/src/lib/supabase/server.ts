import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

/** Supabase client bound to the request's auth cookies (publishable key only — no admin rights). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL as string, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there; middleware refreshes them.
        }
      },
    },
  });
}
