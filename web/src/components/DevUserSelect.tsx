"use client";

interface DevUserSelectProps {
  users: { id: string; label: string }[];
  currentId: string;
}

export function DevUserSelect({ users, currentId }: DevUserSelectProps) {
  return (
    <select
      name="userId"
      defaultValue={currentId}
      aria-label="Entrar como"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="max-w-64 rounded-lg border border-line bg-bg px-2 py-1 text-xs"
    >
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.label}</option>
      ))}
    </select>
  );
}
