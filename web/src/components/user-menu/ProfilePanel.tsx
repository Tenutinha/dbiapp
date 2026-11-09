"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  changePasswordAction, loadProfileAction, removeAvatarAction, uploadAvatarAction, type ProfileFormState,
} from "@/app/perfil/actions";
import { Avatar } from "@/components/admin/Avatar";
import type { UserProfile } from "@/lib/data/users";
import { MAX_PASSWORD, MIN_PASSWORD } from "@/lib/login";

const INITIAL: ProfileFormState = { ok: false, message: "" };
const INPUT = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand";

function Status({ state }: { state: ProfileFormState }) {
  if (!state.message) return null;
  return <p role="status" className={`text-xs ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>;
}

/** Picture: preview the chosen file before sending; remove goes back to initials. */
function AvatarSection({ profile, onChanged }: { profile: UserProfile; onChanged: () => void }) {
  const [upload, uploadAction, uploading] = useActionState(uploadAvatarAction, INITIAL);
  const [remove, removeAction, removing] = useActionState(removeAvatarAction, INITIAL);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (upload.ok || remove.ok) {
      setPreview(null);
      onChanged();
    }
  }, [upload, remove, onChanged]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  return (
    <section className="flex flex-wrap items-center gap-5">
      <Avatar name={profile.name} email={profile.email} imageUrl={preview ?? profile.avatarUrl} size="xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <form action={uploadAction} className="flex flex-wrap items-center gap-2">
          <input
            name="avatar"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
            className="max-w-full text-xs file:mr-3 file:rounded-lg file:border file:border-line file:bg-text/5 file:px-3 file:py-1.5 file:text-text"
          />
          <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={uploading || !preview}>
            {uploading ? "Enviando…" : "Salvar avatar"}
          </button>
        </form>
        <p className="text-xs text-muted">PNG, JPG ou WebP até 1 MB. Uma foto quadrada fica melhor.</p>
        {profile.avatarUrl && (
          <form action={removeAction}>
            <button className="text-xs text-muted hover:text-danger" disabled={removing}>
              {removing ? "Removendo…" : "Remover avatar (voltar às iniciais)"}
            </button>
          </form>
        )}
        <Status state={upload} />
        <Status state={remove} />
      </div>
    </section>
  );
}

function PasswordSection() {
  const [state, action, pending] = useActionState(changePasswordAction, INITIAL);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-3">
      <h3 className="font-semibold">Trocar senha</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Nova senha
          <input name="password" type={show ? "text" : "password"} required minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD}
            autoComplete="new-password" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Repita a nova senha
          <input name="confirm" type={show ? "text" : "password"} required autoComplete="new-password" className={INPUT} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={pending}>{pending ? "Salvando…" : "Salvar nova senha"}</button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar
        </label>
        <span className="text-xs text-muted">Mínimo de {MIN_PASSWORD} caracteres.</span>
      </div>
      <Status state={state} />
    </form>
  );
}

const dateLong = (d: Date | string): string =>
  new Date(d).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });

/** Content of "Meu perfil": loads on open (only ever the signed-in person's own data). */
export function ProfilePanel({ passwordEnabled }: { passwordEnabled: boolean }) {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    void loadProfileAction().then((r) => {
      if (r.ok) setProfile(r.profile);
      else setError(r.message);
    });
  };
  useEffect(load, []);
  const changed = (): void => {
    load();
    router.refresh(); // header and access lists pick up the new picture
  };

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!profile) return <p className="animate-pulse text-sm text-muted">Carregando seu perfil…</p>;

  return (
    <div className="flex flex-col gap-6">
      <AvatarSection profile={profile} onChanged={changed} />

      <section className="grid gap-x-6 gap-y-3 rounded-xl border border-line p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted">Nome</p>
          <p className="font-medium">{profile.name}</p>
        </div>
        <div>
          <p className="text-xs text-muted">E-mail</p>
          <p className="truncate font-medium">{profile.email}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Na plataforma desde</p>
          <p className="font-medium">{dateLong(profile.createdAt)}</p>
        </div>
        {profile.isPlatformAdmin && (
          <div>
            <p className="text-xs text-muted">Plataforma</p>
            <p className="font-medium text-brand-2">Admin master</p>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Onde você tem acesso</h3>
        {profile.memberships.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma organização ou cliente ainda.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {profile.memberships.map((m) => (
              <li key={`${m.href}-${m.role}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <Link href={m.href} className="min-w-0 truncate font-medium hover:text-brand-2">{m.space}</Link>
                <span className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs text-muted">{m.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {passwordEnabled ? (
        <PasswordSection />
      ) : (
        <p className="text-xs text-muted">Troca de senha indisponível neste ambiente (login de desenvolvimento).</p>
      )}
    </div>
  );
}
