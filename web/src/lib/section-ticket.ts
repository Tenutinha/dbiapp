/**
 * Ticket a dashboard page hands to the browser so it can ask, later, for the analyses the page left
 * out of its first answer. The page has already checked who is reading (a member, a shared link); the
 * ticket carries that decision, signed, for a short while — so the request for one more analysis does
 * not have to tell the three ways of reading a dashboard apart again.
 *
 * It names one published version of one dashboard and nothing else: with it, a reader gets only what
 * the page they were given would have shown anyway.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export interface SectionGrant {
  instanceId: string;
  templateId: string;
  activeVersionId: string;
}

/** How long a page can keep asking for its analyses (a reader may leave a dashboard open for a while). */
const TTL_MS = 4 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A key of its own, derived from a secret only the server has. */
function key(): Buffer {
  return createHmac("sha256", env.DATABASE_URL).update("dbi:section-ticket:v1").digest();
}

const sign = (body: string): string => createHmac("sha256", key()).update(body).digest("base64url");

export function issueSectionTicket(grant: SectionGrant, now: number = Date.now()): string {
  const body = Buffer.from(JSON.stringify([grant.instanceId, grant.templateId, grant.activeVersionId, now + TTL_MS])).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The grant a ticket carries, or null when it is forged, malformed or expired. */
export function readSectionTicket(ticket: string, now: number = Date.now()): SectionGrant | null {
  if (typeof ticket !== "string" || ticket.length > 600) return null;
  const [body, signature, ...rest] = ticket.split(".");
  if (!body || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const [instanceId, templateId, activeVersionId, expires] = parsed as unknown[];
    if (typeof instanceId !== "string" || !UUID.test(instanceId)) return null;
    if (typeof activeVersionId !== "string" || !UUID.test(activeVersionId)) return null;
    if (typeof templateId !== "string" || !/^[a-z0-9-]{1,120}$/.test(templateId)) return null;
    if (typeof expires !== "number" || expires < now) return null;
    return { instanceId, templateId, activeVersionId };
  } catch {
    return null;
  }
}
