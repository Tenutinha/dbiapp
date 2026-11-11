/**
 * Each client of an organization has its own folder in the bucket: orgs/<org>/clientes/<cliente>/.
 * Created with the client; when the client's address changes, its files move to the new folder — the
 * dashboards' Parquet files (dashboards/) included, and the database follows them.
 */
import "server-only";
import { createClient, findClientSlug, renameClient } from "../data/organizations";
import { rewriteDatasetPaths } from "../data/repository";
import { storage } from "../storage";
import { clientFolder } from "../storage-keys";

export async function createClientWithFolder(org: { id: string; slug: string }, name: string, slug: string): Promise<void> {
  await createClient(org.id, name, slug);
  await storage.createClientFolder(org.slug, slug);
}

/**
 * Renames the client and, when its address changed, moves its folder. The rename never fails because of
 * the bucket: files that could not move stay in the old folder (logged) and can be moved again later.
 */
export async function renameClientWithFolder(
  org: { id: string; slug: string }, clientId: string, name: string, slug: string,
): Promise<boolean> {
  const previous = await findClientSlug(org.id, clientId);
  if (previous === null) return false;
  if (!(await renameClient(org.id, clientId, name, slug))) return false;
  if (previous !== slug) {
    const from = clientFolder(org.slug, previous);
    const to = clientFolder(org.slug, slug);
    try {
      const moved = await storage.moveFolder(from, to);
      // The dashboards read their Parquet files from the client's folder (dashboards/): follow them.
      const tables = await rewriteDatasetPaths(from, to);
      console.info(`[storage] client folder ${org.slug}/${previous} → ${slug}: ${moved} file(s) moved, ${tables} dashboard table(s) repointed`);
    } catch (err) {
      console.error("[storage] could not move client folder", org.slug, previous, slug, err);
    }
  }
  await storage.createClientFolder(org.slug, slug);
  return true;
}
