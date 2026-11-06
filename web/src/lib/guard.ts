import "server-only";
import { notFound, redirect } from "next/navigation";
import { AccessError } from "./auth";

export const FORBIDDEN = "forbidden" as const;

/**
 * Page-level access: signed-out visitors go to the login page; anything not visible renders the
 * 404 page (no tenant leaks); visible-but-not-allowed returns FORBIDDEN so the page can explain.
 */
export async function guard<T>(load: Promise<T>): Promise<T | typeof FORBIDDEN> {
  try {
    return await load;
  } catch (err) {
    if (err instanceof AccessError && err.status === 401) redirect("/entrar");
    if (err instanceof AccessError && err.status === 404) notFound();
    if (err instanceof AccessError && err.status === 403) return FORBIDDEN;
    throw err;
  }
}
