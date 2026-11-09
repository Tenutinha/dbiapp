"use client";

import { useActionState, useState } from "react";
import {
  removeLogoAction, saveColorsAction, uploadLogoAction, type ThemeFormState,
} from "@/app/[org]/admin/aparencia/actions";
import { resolveTheme, themeCssVars, type Appearance, type BrandingInput, type Theme } from "@/lib/theme/theme";

const INITIAL: ThemeFormState = { ok: false, message: "" };

interface ThemeFormProps {
  orgSlug: string;
  clientSlug: string | null;
  spaceName: string;
  /** What this space set itself. */
  input: BrandingInput;
  /** What it inherits when a value is not set (org theme for clients, platform default for the org). */
  inherited: Theme;
  inheritedLabel: string;
  logoUrl: string | null;
  inheritedLogoUrl: string | null;
}

type ColorKey = "primaryColor" | "secondaryColor" | "sidebarColor";
const COLORS: { key: ColorKey; label: string; hint: string }[] = [
  { key: "primaryColor", label: "Cor principal", hint: "Botões, destaques e primeira série dos gráficos." },
  { key: "secondaryColor", label: "Cor secundária", hint: "Segunda série dos gráficos e detalhes." },
  { key: "sidebarColor", label: "Fundo do sumário", hint: "O texto se ajusta para manter a leitura." },
];

function Status({ state }: { state: ThemeFormState }) {
  if (!state.message) return null;
  return <p role="status" className={`text-xs ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>;
}

function Preview({ theme, logoUrl, spaceName }: { theme: Theme; logoUrl: string | null; spaceName: string }) {
  return (
    <div style={themeCssVars(theme) as React.CSSProperties} className="overflow-hidden rounded-xl border border-line" aria-label="Pré-visualização">
      <div className="flex h-64 bg-bg text-text">
        <div className="flex w-40 flex-col gap-2 bg-paper p-3 text-ink">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="max-h-8 max-w-28 object-contain object-left" />
          ) : null}
          <p className="text-[13px]">{spaceName}</p>
          <p className="mt-2 text-[10px] text-ink-muted">Comercial</p>
          <p className="border-l border-ink pl-2 text-[11px] font-medium">Visão geral</p>
          <p className="border-l border-paper-line pl-2 text-[11px]">Funil</p>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <p className="font-serif text-2xl">Visão geral</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line bg-card p-2 text-[10px] text-muted">Receita<p className="text-sm font-bold text-text">R$ 2,8 mi</p></div>
            <div className="rounded-lg border border-line bg-card p-2 text-[10px] text-muted">Margem<p className="text-sm font-bold text-text">35%</p></div>
          </div>
          <div className="flex h-16 items-end gap-1 rounded-lg border border-line bg-card p-2">
            {[40, 65, 50, 80, 70, 95].map((h, i) => (
              <span key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: i % 2 ? "var(--color-brand-2)" : "var(--color-brand)" }} />
            ))}
          </div>
          <span className="btn btn-primary self-start px-3 py-1 text-[11px]">Botão</span>
        </div>
      </div>
    </div>
  );
}

/** Quick picks for the dashboard background: soft lights first, then deep darks. */
const BACKGROUND_PRESETS = ["#ffffff", "#f6f5f1", "#eef2ff", "#f0fdf4", "#fff7ed", "#0b1220", "#111827", "#1e1b4b", "#052e2b"];

interface BackgroundPickerProps {
  /** What this space set (null = not set here). */
  own: string | null;
  /** What it would inherit (organization's background for a client; null = the appearance's own). */
  inherited: string | null;
  inheritedLabel: string;
  /** The background the preview shows right now. */
  shown: string;
  onChange: (color: string | null) => void;
}

/** "Fundo do dashboard": the colour behind the cards; cards, lines and text follow it. */
function BackgroundPicker({ own, inherited, inheritedLabel, shown, onChange }: BackgroundPickerProps) {
  const note = own
    ? "Os cartões, linhas e textos se ajustam à cor; a área fica clara ou escura conforme ela."
    : inherited
      ? `Herdando de ${inheritedLabel}.`
      : "Padrão: o fundo da área clara ou escura escolhida acima.";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <input
          type="color"
          aria-label="Fundo do dashboard"
          value={shown}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="size-10 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0.5"
        />
        <input type="hidden" name="backgroundColor" value={own ?? ""} />
        <div className="min-w-0 flex-1">
          <p className="text-sm">Fundo do dashboard <span className="font-mono text-xs text-muted">{shown}</span></p>
          <p className="text-xs text-muted">{note}</p>
        </div>
        {own && (
          <button type="button" onClick={() => onChange(null)} className="text-xs text-muted hover:text-text">Usar o padrão</button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 pl-[52px]" role="group" aria-label="Sugestões de fundo">
        {BACKGROUND_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            aria-label={`Fundo ${c}`}
            aria-pressed={own === c}
            style={{ background: c }}
            className={`size-6 rounded-md border transition hover:scale-110 ${own === c ? "border-brand ring-2 ring-brand/40" : "border-line"}`}
          />
        ))}
      </div>
    </div>
  );
}

export function ThemeForm(props: ThemeFormProps) {
  const { orgSlug, clientSlug, input, inherited, inheritedLabel } = props;
  const [draft, setDraft] = useState<BrandingInput>(input);
  const [colorsState, saveColors, savingColors] = useActionState(saveColorsAction, INITIAL);
  const [logoState, uploadLogo, uploading] = useActionState(uploadLogoAction, INITIAL);
  const [removeState, removeLogo, removing] = useActionState(removeLogoAction, INITIAL);

  const preview = resolveTheme(draft, inherited);
  const shownLogo = props.logoUrl ?? props.inheritedLogoUrl;
  const scopeFields = (
    <>
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="client" value={clientSlug ?? ""} />
    </>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col gap-6">
        <section className="card flex flex-col gap-4 p-5">
          <h2 className="font-semibold">Logo</h2>
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-40 place-items-center rounded-lg border border-line bg-paper p-2">
              {shownLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownLogo} alt="Logo atual" className="max-h-12 max-w-36 object-contain" />
              ) : (
                <span className="text-xs text-ink-muted">Sem logo</span>
              )}
            </div>
            <p className="text-xs text-muted">
              {props.logoUrl ? "Logo deste espaço." : props.inheritedLogoUrl ? `Herdado de ${inheritedLabel}.` : "PNG, JPG ou WebP até 1 MB. Fundo transparente fica melhor."}
            </p>
          </div>
          <form action={uploadLogo} className="flex flex-wrap items-center gap-2">
            {scopeFields}
            <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" required
              className="text-xs file:mr-3 file:rounded-lg file:border file:border-line file:bg-text/5 file:px-3 file:py-1.5 file:text-text" />
            <button className="btn btn-ghost px-3 py-1.5 text-xs" disabled={uploading}>{uploading ? "Enviando…" : "Enviar logo"}</button>
          </form>
          {props.logoUrl && (
            <form action={removeLogo}>
              {scopeFields}
              <button className="text-xs text-muted hover:text-danger" disabled={removing}>Remover logo deste espaço</button>
            </form>
          )}
          <Status state={logoState} />
          <Status state={removeState} />
        </section>

        <form action={saveColors} className="card flex flex-col gap-4 p-5">
          {scopeFields}
          <h2 className="font-semibold">Cores</h2>
          {COLORS.map(({ key, label, hint }) => {
            const own = draft[key];
            return (
              <div key={key} className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label={label}
                  value={own ?? inherited[key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.toLowerCase() }))}
                  className="size-10 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0.5"
                />
                <input type="hidden" name={key} value={own ?? ""} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{label} <span className="font-mono text-xs text-muted">{own ?? inherited[key]}</span></p>
                  <p className="text-xs text-muted">{own ? hint : `Herdando de ${inheritedLabel}. ${hint}`}</p>
                </div>
                {own && (
                  <button type="button" onClick={() => setDraft((d) => ({ ...d, [key]: null }))} className="text-xs text-muted hover:text-text">
                    Restaurar
                  </button>
                )}
              </div>
            );
          })}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm">Área do dashboard</legend>
            <div className="flex flex-wrap gap-2">
              {([[null, `Herdar (${inherited.appearance === "dark" ? "escura" : "clara"})`], ["dark", "Escura"], ["light", "Clara"]] as const).map(
                ([value, label]) => (
                  <label key={label} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${draft.appearance === value ? "border-brand bg-brand/15" : "border-line"}`}>
                    <input
                      type="radio"
                      name="appearanceChoice"
                      className="sr-only"
                      checked={draft.appearance === value}
                      onChange={() => setDraft((d) => ({ ...d, appearance: value as Appearance | null }))}
                    />
                    {label}
                  </label>
                ),
              )}
            </div>
            <input type="hidden" name="appearance" value={draft.appearance ?? ""} />
          </fieldset>

          <BackgroundPicker
            own={draft.backgroundColor}
            inherited={inherited.backgroundColor}
            inheritedLabel={inheritedLabel}
            shown={themeCssVars(preview)["--color-bg"]}
            onChange={(backgroundColor) => setDraft((d) => ({ ...d, backgroundColor }))}
          />

          <div className="flex items-center gap-3">
            <button className="btn btn-primary" disabled={savingColors}>{savingColors ? "Salvando…" : "Salvar cores"}</button>
            <button type="button" className="text-xs text-muted hover:text-text" onClick={() => setDraft(input)}>Desfazer alterações</button>
          </div>
          <Status state={colorsState} />
        </form>
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-2 text-xs text-muted">Pré-visualização</p>
        <Preview theme={preview} logoUrl={shownLogo} spaceName={props.spaceName} />
      </div>
    </div>
  );
}
