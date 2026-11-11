/** What the installed app (PWA) shows around the pages: its name, icons and the colour of the splash screen and status bar. */
import type { MetadataRoute } from "next";

export const APP_NAME = "DBI";
export const APP_DESCRIPTION = "Dashboards prontos — é só engatar os seus dados.";
/** Background of the platform screens in the light theme (--color-bg in globals.css). */
export const APP_BACKGROUND = "#fbfbf9";

const ICONS: MetadataRoute.Manifest["icons"] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

const MAX_ORG_NAME = 60;

/** Name under the icon when the app is installed from an organization's pages: "DBI-Controle". */
export function orgAppName(orgName: string): string {
  const clean = orgName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ORG_NAME);
  return clean ? `${APP_NAME}-${clean}` : APP_NAME;
}

/** Address of an organization's manifest. The name travels in it: the browser fetches manifests without the session. */
export function orgManifestHref(orgSlug: string, orgName: string): string {
  return `/${orgSlug}/app.webmanifest?nome=${encodeURIComponent(orgName)}`;
}

/**
 * The manifest of the whole platform (no organization) or of one organization: installed from its
 * pages, the app is called "DBI-<organização>" and opens on that organization.
 */
export function appManifest(org?: { slug: string; name: string }): MetadataRoute.Manifest {
  const name = org ? orgAppName(org.name) : APP_NAME;
  const start = org ? `/${org.slug}` : "/";
  return {
    id: start,
    name,
    short_name: name,
    description: APP_DESCRIPTION,
    lang: "pt-BR",
    start_url: start,
    scope: "/", // signing in and the profile live outside /<org>
    display: "standalone",
    background_color: APP_BACKGROUND,
    theme_color: APP_BACKGROUND,
    icons: ICONS,
  };
}
