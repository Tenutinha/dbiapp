"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/entrar/actions";
import { Avatar } from "@/components/admin/Avatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProfileModal } from "./ProfileModal";

export interface UserMenuLink {
  label: string;
  href: string;
}

interface UserMenuProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  /** Navigation for this page (Início, the organization, its administration…). */
  links: UserMenuLink[];
  /** Real login (Supabase Auth): show "Sair" and the password form. */
  authEnabled: boolean;
}

const ITEM =
  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-text/5";

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-muted"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * The person's avatar in the header's right corner. Hovering (or focusing / tapping)
 * opens the menu — navigation, light/dark theme, "Meu perfil" (data, password, avatar) and "Sair".
 */
export function UserMenu({
  name,
  email,
  avatarUrl,
  links,
  authEnabled,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // Small delay so the pointer can travel from the avatar to the menu without it closing.
  const hide = (): void => {
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  const wrapper = useRef<HTMLDivElement>(null);

  // A tap or click anywhere else closes it (touch screens have no "mouse leave").
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <>
      <div
        ref={wrapper}
        className="relative"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <button
          type="button"
          onClick={show}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Menu de ${name}`}
          className="flex items-center rounded-full outline-none ring-brand/50 transition hover:ring-2 focus-visible:ring-2"
        >
          <Avatar
            name={name}
            email={email}
            imageUrl={avatarUrl}
            size="md"
            title={name}
          />
        </button>

        <div
          role="menu"
          className={`absolute right-0 top-full z-50 pt-2 transition duration-150 ${open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"}`}
        >
          <div className="w-72 rounded-2xl border border-line bg-card-2 p-2 text-text shadow-2xl shadow-black/30">
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar
                name={name}
                email={email}
                imageUrl={avatarUrl}
                size="lg"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{name}</p>
                <p className="truncate text-xs text-muted">{email}</p>
              </div>
            </div>
            <div className="my-1 border-t border-line" />

            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                className={ITEM}
                onClick={() => setOpen(false)}
              >
                <Icon d="M9 18l6-6-6-6" />
                {l.label}
              </Link>
            ))}
            {links.length > 0 && <div className="my-1 border-t border-line" />}

            <button
              type="button"
              role="menuitem"
              className={ITEM}
              onClick={() => {
                setOpen(false);
                setProfileOpen(true);
              }}
            >
              <Icon d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
              Meu perfil
              <span className="ml-auto text-xs text-muted">
                dados, senha, avatar
              </span>
            </button>

            <ThemeToggle withLabel className={`${ITEM} [&>svg]:text-muted`} />

            {authEnabled && (
              <form action={signOutAction}>
                <button
                  type="submit"
                  role="menuitem"
                  className={`${ITEM} text-danger hover:bg-danger/10`}
                >
                  <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                  Sair
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Outside the hover area: focus inside the modal must not reopen the menu. */}
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        passwordEnabled={authEnabled}
      />
    </>
  );
}
