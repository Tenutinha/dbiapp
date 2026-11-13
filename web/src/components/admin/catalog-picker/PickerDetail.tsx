"use client";

import type { PickerItem, VisualKind } from "@/lib/catalog-picker";
import { ORIGIN_LABEL } from "@/lib/templates/labels";
import { Poster } from "./Poster";

const KIND_LABEL: Record<VisualKind, string> = {
  kpi: "indicadores",
  bar: "barras",
  line: "linhas",
  donut: "roscas",
  table: "tabelas",
  map: "mapas",
  rows: "listagens",
  text: "textos",
  statement: "demonstrativos",
};

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <p className="text-lg font-bold tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-muted">{label}</p>
    </div>
  );
}

interface PickerDetailProps {
  item: PickerItem;
  hue: number;
  spaceName: string;
  linked: boolean;
  pending: boolean;
  error: string | null;
  onAdd: () => void;
}

/** Featured dashboard at the top of the picker: cover, what it shows, its analyses and the add button. */
export function PickerDetail({ item, hue, spaceName, linked, pending, error, onAdd }: PickerDetailProps) {
  const facts = item.tables.filter((t) => t.kind === "fact");
  const dims = item.tables.filter((t) => t.kind === "dimension");
  const kinds = (Object.entries(item.visualKinds) as [VisualKind, number][]).sort((a, b) => b[1] - a[1]);

  return (
    <section aria-live="polite" className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex flex-col gap-3">
        <Poster item={item} hue={hue} large className="shadow-2xl shadow-black/30" />
        <div className="grid grid-cols-4 gap-2">
          <Stat value={item.analyses.length} label="análises" />
          <Stat value={item.visualCount} label="visuais" />
          <Stat value={facts.length} label={facts.length === 1 ? "fato" : "fatos"} />
          <Stat value={dims.length} label={dims.length === 1 ? "dimensão" : "dimensões"} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md bg-brand/15 px-2 py-0.5 font-semibold text-brand-2">{item.area}</span>
          <span className="rounded-md border border-line px-2 py-0.5 text-muted">{ORIGIN_LABEL[item.origin]}</span>
          {kinds.length > 0 && (
            <span className="text-muted">{kinds.map(([k, n]) => `${n} ${KIND_LABEL[k]}`).join(" · ")}</span>
          )}
        </div>
        <h3 className="mt-2 text-2xl font-extrabold tracking-tight">{item.name}</h3>
        <p className="mt-1 text-sm text-muted">{item.description}</p>

        <div className="mt-4 min-h-0 flex-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">O que ele analisa</p>
          {item.analyses.length === 0 ? (
            <p className="text-sm text-muted">Uma página única com {item.visualCount} visuais.</p>
          ) : (
            <ol className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {item.analyses.map((a, i) => (
                <li key={`${i}-${a.title}`} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-text/5 text-[11px] font-bold text-muted">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{a.title}</span>
                    {a.description && <span className="line-clamp-2 block text-xs text-muted">{a.description}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Dados que ele pede</p>
          <div className="flex flex-wrap gap-1.5">
            {[...facts, ...dims].map((t) => (
              <code
                key={t.name}
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${t.kind === "fact" ? "border-brand/40 text-brand-2" : "border-line text-muted"}`}
                title={t.kind === "fact" ? "Fato" : "Dimensão"}
              >
                {t.name}
              </code>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {linked ? (
            <span className="rounded-xl border border-ok/40 bg-ok/10 px-4 py-2.5 text-sm font-semibold text-ok">
              ✓ Já está em {spaceName}
            </span>
          ) : (
            <button type="button" onClick={onAdd} disabled={pending} className="btn btn-primary px-5 py-2.5 text-sm">
              {pending ? "Adicionando…" : `+ Adicionar a ${spaceName}`}
            </button>
          )}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      </div>
    </section>
  );
}
