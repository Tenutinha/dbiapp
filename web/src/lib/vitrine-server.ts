import "server-only";
import { listUserOrganizations, type UserOrg } from "./access";
import { AccessError, getCurrentUser, type CurrentUser } from "./auth";
import { orgsThatCanAdd } from "./vitrine";

/** Who is looking at the public showcase: nobody (signed out) or a user and where they may add dashboards. */
export interface VitrineViewer {
  user: CurrentUser;
  /** Organizations where this user may activate a dashboard. */
  orgs: UserOrg[];
}

async function currentUserOrNull(): Promise<CurrentUser | null> {
  try {
    return await getCurrentUser();
  } catch (err) {
    if (err instanceof AccessError) return null; // signed out, or signed in without access: show as visitor
    throw err;
  }
}

export async function getVitrineViewer(): Promise<VitrineViewer | null> {
  const user = await currentUserOrNull();
  if (!user) return null;
  const orgs = await listUserOrganizations(user.id, user.isPlatformAdmin);
  return { user, orgs: orgsThatCanAdd(orgs, user.isPlatformAdmin) };
}
