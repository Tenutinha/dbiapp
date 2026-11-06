import "server-only";
import { notFound } from "next/navigation";
import { AccessError } from "./auth";

export const FORBIDDEN = "forbidden" as const;

/**
 * Page-level access: anything not visible renders the 404 page (no tenant leaks);
 * visible-but-not-allowed returns FORBIDDEN so the page can explain.
 */
export async function guard<T>(load: Promise<T>): Promise<T | typeof FORBIDDEN> {
  try {
    return await load;
  } catch (err) {
    if (err instanceof AccessError && (err.status === 404 || err.status === 401)) notFound();
    if (err instanceof AccessError && err.status === 403) return FORBIDDEN;
    throw err;
  }
}
