"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { SpaceOption } from "@/lib/space-options";

const KIND_LABEL = { org: "Organização", client: "Cliente" } as const;

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Sidebar, under the organization's logo: which space is open (the organization or a client).
 * More than one accessible space (e.g. admins) → a selector that opens the chosen one;
 * only one → just its name.
 */
export function SpaceSwitcher({ spaces }: { spaces: SpaceOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = spaces.find((s) => s.current) ?? spaces[0];
  if (!current) return null;

  if (spaces.length <= 1) {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{KIND_LABEL[current.kind]}</p>
        <Link href={current.href} className="block text-[19px] leading-tight hover:underline">{current.label}</Link>
      </div>
    );
  }

  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {pending ? "Abrindo…" : KIND_LABEL[current.kind]}
      </span>
      <span className="relative mt-1 block">
        <select
          value={current.href}
          disabled={pending}
          onChange={(e) => {
            const href = e.target.value;
            start(() => router.push(href));
          }}
          aria-label="Trocar de cliente"
          className="w-full cursor-pointer appearance-none rounded-lg border border-paper-line bg-paper py-2 pl-3 pr-9 text-[17px] leading-tight text-ink outline-none transition hover:border-ink-muted focus:border-ink disabled:opacity-60"
        >
          {(["org", "client"] as const).map((kind) => {
            const group = spaces.filter((s) => s.kind === kind);
            if (group.length === 0) return null;
            return (
              <optgroup key={kind} label={kind === "org" ? "Organização" : "Clientes"}>
                {group.map((s) => <option key={s.href} value={s.href}>{s.label}</option>)}
              </optgroup>
            );
          })}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">
          <ChevronIcon />
        </span>
      </span>
      <span className="mt-1 block text-[12px] text-ink-muted">{spaces.length} espaços com acesso</span>
    </label>
  );
}
