import { devSwitchUser } from "@/app/actions";
import { getCurrentUser, listUsersForDevSwitcher } from "@/lib/auth";
import { DevUserSelect } from "./DevUserSelect";

/** Dev-only bar to act as any seeded user. Renders nothing when dev auth is off. */
export async function DevUserSwitcher() {
  const users = await listUsersForDevSwitcher();
  if (users.length === 0) return null;
  const current = await getCurrentUser();

  return (
    <form
      action={devSwitchUser}
      className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-xl border border-accent/40 bg-card-2/95 px-3 py-2 text-xs shadow-2xl backdrop-blur"
    >
      <span className="font-semibold text-accent">DEV · entrar como</span>
      <DevUserSelect users={users.map((u) => ({ id: u.id, label: `${u.name} · ${u.email}` }))} currentId={current.id} />
    </form>
  );
}
