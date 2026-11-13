import "server-only";
import { sql } from "../db";
import { resolveTheme, type Appearance, type BrandingInput, type Theme } from "../theme/theme";
import type { LogoMime } from "../theme/logo";

interface BrandingRow extends BrandingInput {
  clientId: string | null;
  logoKey: string | null;
}

export interface SpaceBranding {
  input: BrandingInput;
  logoUrl: string | null;
}

export interface EffectiveBranding {
  theme: Theme;
  logoUrl: string | null;
}

const NIL = "00000000-0000-0000-0000-000000000000";
export const logoUrl = (key: string | null): string | null => (key ? `/api/branding/logo/${key}` : null);

const toInput = (r: BrandingRow | undefined): BrandingInput => ({
  primaryColor: r?.primaryColor ?? null,
  secondaryColor: r?.secondaryColor ?? null,
  sidebarColor: r?.sidebarColor ?? null,
  appearance: (r?.appearance ?? null) as Appearance | null,
  backgroundColor: r?.backgroundColor ?? null,
  headerColor: r?.headerColor ?? null,
});

async function rowsFor(orgId: string, clientId: string | null): Promise<BrandingRow[]> {
  // background_color and header_color are read through to_jsonb so this still works before migrations
  // 011 and 020 (then: null).
  return sql<BrandingRow[]>`
    SELECT client_id AS "clientId", primary_color AS "primaryColor", secondary_color AS "secondaryColor",
           sidebar_color AS "sidebarColor", appearance, logo_key AS "logoKey",
           to_jsonb(space_branding) ->> 'background_color' AS "backgroundColor",
           to_jsonb(space_branding) ->> 'header_color' AS "headerColor"
    FROM space_branding
    WHERE organization_id = ${orgId}
      AND (client_id IS NULL ${clientId ? sql`OR client_id = ${clientId}` : sql``})`;
}

/** What this exact space set (no inheritance) — for the admin form. */
export async function getSpaceBranding(orgId: string, clientId: string | null): Promise<SpaceBranding> {
  const row = (await rowsFor(orgId, clientId)).find((r) => r.clientId === clientId);
  return { input: toInput(row), logoUrl: logoUrl(row?.logoKey ?? null) };
}

/** Theme and logo a space actually shows: client → organization → default. */
export async function getEffectiveBranding(orgId: string, clientId: string | null): Promise<EffectiveBranding> {
  const rows = await rowsFor(orgId, clientId);
  const org = rows.find((r) => r.clientId === null);
  const client = clientId ? rows.find((r) => r.clientId === clientId) : undefined;
  return {
    theme: resolveTheme(client ? toInput(client) : null, toInput(org)),
    logoUrl: logoUrl(client?.logoKey ?? org?.logoKey ?? null),
  };
}

/** The database has no background_color column yet (migration 011 missing). */
export class BackgroundColorUnavailableError extends Error {}

/** The database has no header_color column yet (migration 020 missing). */
export class HeaderColorUnavailableError extends Error {}

const isMissingColumn = (err: unknown): boolean => (err as { code?: string }).code === "42703";

async function saveWithBackground(orgId: string, clientId: string | null, input: BrandingInput): Promise<void> {
  try {
    await sql`
      INSERT INTO space_branding (organization_id, client_id, primary_color, secondary_color, sidebar_color, appearance, background_color)
      VALUES (${orgId}, ${clientId}, ${input.primaryColor}, ${input.secondaryColor}, ${input.sidebarColor}, ${input.appearance}, ${input.backgroundColor})
      ON CONFLICT (organization_id, COALESCE(client_id, ${NIL}::uuid)) DO UPDATE SET
        primary_color = EXCLUDED.primary_color, secondary_color = EXCLUDED.secondary_color,
        sidebar_color = EXCLUDED.sidebar_color, appearance = EXCLUDED.appearance,
        background_color = EXCLUDED.background_color, updated_at = now()`;
  } catch (err) {
    // Before migration 011: save the other colours and only refuse a background.
    if (!isMissingColumn(err)) throw err;
    if (input.backgroundColor) throw new BackgroundColorUnavailableError();
    await sql`
      INSERT INTO space_branding (organization_id, client_id, primary_color, secondary_color, sidebar_color, appearance)
      VALUES (${orgId}, ${clientId}, ${input.primaryColor}, ${input.secondaryColor}, ${input.sidebarColor}, ${input.appearance})
      ON CONFLICT (organization_id, COALESCE(client_id, ${NIL}::uuid)) DO UPDATE SET
        primary_color = EXCLUDED.primary_color, secondary_color = EXCLUDED.secondary_color,
        sidebar_color = EXCLUDED.sidebar_color, appearance = EXCLUDED.appearance, updated_at = now()`;
  }
}

export async function saveSpaceColors(orgId: string, clientId: string | null, input: BrandingInput): Promise<void> {
  try {
    await sql`
      INSERT INTO space_branding (organization_id, client_id, primary_color, secondary_color, sidebar_color, appearance, background_color, header_color)
      VALUES (${orgId}, ${clientId}, ${input.primaryColor}, ${input.secondaryColor}, ${input.sidebarColor}, ${input.appearance}, ${input.backgroundColor}, ${input.headerColor})
      ON CONFLICT (organization_id, COALESCE(client_id, ${NIL}::uuid)) DO UPDATE SET
        primary_color = EXCLUDED.primary_color, secondary_color = EXCLUDED.secondary_color,
        sidebar_color = EXCLUDED.sidebar_color, appearance = EXCLUDED.appearance,
        background_color = EXCLUDED.background_color, header_color = EXCLUDED.header_color, updated_at = now()`;
  } catch (err) {
    // 42703 = undefined column: before migration 020, save the other colours and only refuse a header colour.
    if (!isMissingColumn(err)) throw err;
    if (input.headerColor) throw new HeaderColorUnavailableError();
    await saveWithBackground(orgId, clientId, input);
  }
}

/** Sets (or clears, with null) the space's logo. Returns the previous file path so it can be deleted. */
export async function setSpaceLogo(
  orgId: string,
  clientId: string | null,
  logo: { key: string; path: string; mime: LogoMime } | null,
): Promise<string | null> {
  return sql.begin(async (tx) => {
    const [prev] = await tx<{ logoPath: string | null }[]>`
      SELECT logo_path AS "logoPath" FROM space_branding
      WHERE organization_id = ${orgId} AND COALESCE(client_id, ${NIL}::uuid) = COALESCE(${clientId}::uuid, ${NIL}::uuid)
      FOR UPDATE`;
    await tx`
      INSERT INTO space_branding (organization_id, client_id, logo_key, logo_path, logo_mime)
      VALUES (${orgId}, ${clientId}, ${logo?.key ?? null}, ${logo?.path ?? null}, ${logo?.mime ?? null})
      ON CONFLICT (organization_id, COALESCE(client_id, ${NIL}::uuid)) DO UPDATE SET
        logo_key = EXCLUDED.logo_key, logo_path = EXCLUDED.logo_path, logo_mime = EXCLUDED.logo_mime, updated_at = now()`;
    return prev?.logoPath ?? null;
  });
}

export async function findLogo(key: string): Promise<{ path: string; mime: LogoMime } | null> {
  const [row] = await sql<{ path: string; mime: LogoMime }[]>`
    SELECT logo_path AS path, logo_mime AS mime FROM space_branding WHERE logo_key = ${key}`;
  return row ?? null;
}
