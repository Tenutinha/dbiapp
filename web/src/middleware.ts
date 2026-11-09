import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * With Supabase Auth on, keeps the session cookie fresh on every navigation
 * (Server Components cannot write cookies themselves). No-op in local dev mode.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (process.env.DBI_AUTH !== "supabase" || !url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // Refreshes an expired session (writing the new cookies) and verifies the JWT locally against
  // the project's signing keys — no round trip to Supabase Auth on every navigation.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Skip static assets, logos and the public guest links.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/branding|s/).*)"],
};
