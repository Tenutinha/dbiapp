"use client";

import { useMemo } from "react";
import type { ColumnStatus } from "@/lib/ingest/schema-check";
import type { ConnectorTable, FilePick, FileState, Link, LinkFile } from "./types";

const CONFETTI_COLORS = ["var(--color-brand)", "var(--color-brand-2)", "var(--color-ok)", "var(--color-accent)", "#f472b6"];

/** Little celebration when a table is engaged. Pure CSS; positions are fixed per mount. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const angle = (i / 18) * Math.PI * 2;
        const dist = 60 + ((i * 37) % 50);
        return {
          dx: `${Math.round(Math.cos(angle) * dist)}px`,
          dy: `${Math.round(Math.sin(angle) * dist - 20)}px`,
          rot: `${(i * 67) % 360}deg`,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          round: i % 3 === 0,
        };
      }),
    [],
  );
  return (
    <span className="pointer-events-none absolute right-8 top-1/2 z-20" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`dbi-confetti absolute block size-2 ${p.round ? "rounded-full" : "rounded-[1px]"}`}
          style={{ background: p.color, "--dx": p.dx, "--dy": p.dy, "--rot": p.rot } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

/** Plug + socket drawing: apart when idle, sliding in while engaging, locked (with spark) when engaged. */
function Coupler({ phase }: { phase: Link["phase"] | undefined }) {
  const engaged = phase === "engaged";
  const engaging = phase === "engaging";
  const plugClass = engaged ? "dbi-plug-in" : engaging ? "dbi-plug-wiggle" : "";
  const tone = engaged ? "text-ok" : phase === "diverge" || phase === "failed" ? "text-danger" : engaging ? "text-brand-2" : "text-muted";
  return (
    <svg width="54" height="28" viewBox="0 0 54 28" className={tone} aria-hidden>
      <g className={plugClass} style={{ transform: engaged || engaging ? undefined : "translateX(-8px)" }}>
        <rect x="4" y="8" width="16" height="12" rx="3" fill="currentColor" opacity="0.85" />
        <rect x="20" y="10" width="7" height="2.5" rx="1" fill="currentColor" />
        <rect x="20" y="15.5" width="7" height="2.5" rx="1" fill="currentColor" />
        <path d="M4 14 H0" stroke="currentColor" strokeWidth="2.5" />
      </g>
      <rect x="29" y="5" width="20" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="35" cy="11.5" r="1.4" fill="currentColor" />
      <circle cx="35" cy="16.5" r="1.4" fill="currentColor" />
      {engaged && <path d="M51 3 l2 -3 M53 9 l3 0 M51 25 l2 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}

const STATUS_ICON: Record<ColumnStatus, { icon: string; tone: string; label: string }> = {
  ok: { icon: "✓", tone: "text-ok", label: "ok" },
  convert: { icon: "↻", tone: "text-accent", label: "será convertida" },
  missing: { icon: "✕", tone: "text-danger", label: "não encontrada" },
  optional: { icon: "–", tone: "text-muted", label: "opcional, ausente" },
};

const FILE_STATE: Record<FileState, { icon: string; tone: string; label: string }> = {
  suggested: { icon: "?", tone: "text-muted", label: "sugestão pelo nome" },
  checking: { icon: "…", tone: "animate-pulse text-brand-2", label: "lendo as colunas" },
  ok: { icon: "✓", tone: "text-ok", label: "as colunas batem" },
  diverge: { icon: "⚠", tone: "text-danger", label: "as colunas divergem" },
  failed: { icon: "✕", tone: "text-danger", label: "não foi possível ler" },
};

const pathOf = (f: FilePick): string => [f.folder, f.file].filter(Boolean).join("/");
const rows = (n: number): string => `${n.toLocaleString("pt-BR")} linhas`;

/** The files that feed the table: where each one is in the check and, once engaged, how many rows it gave. */
function Files({ link, busy, onRemove }: { link: Link; busy: boolean; onRemove: (file: FilePick) => void }) {
  const given = new Map(link.report?.ok ? link.report.files?.map((f) => [f.name, f.rowCount]) : []);
  return (
    <ul className="mt-2 flex flex-col gap-0.5 font-mono text-[11px]" aria-label={`Arquivos de ${link.table}`}>
      {link.files.map((f) => {
        const state = FILE_STATE[f.state];
        const count = given.get(f.file);
        return (
          <li key={pathOf(f)} className="flex items-center gap-1.5">
            <span className={`w-3 shrink-0 text-center ${state.tone}`} title={state.label} aria-label={state.label}>{state.icon}</span>
            <span className="min-w-0 flex-1 truncate text-muted" title={pathOf(f)}>{pathOf(f)}</span>
            {count !== undefined && <span className="shrink-0 text-muted">{rows(count)}</span>}
            {!busy && link.files.length > 1 && (
              <button type="button" onClick={() => onRemove(f)} title="Tirar este arquivo" aria-label={`Tirar ${f.file} de ${link.table}`} className="shrink-0 px-0.5 text-muted hover:text-danger">×</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Columns({ table, link }: { table: ConnectorTable; link: Link | undefined }) {
  // With several files, the one that diverges is the one worth looking at.
  const shown = link?.files.find((f) => f.state === "diverge") ?? link?.files.find((f) => f.check);
  const check = shown?.check;
  return (
    <details className="mt-2 text-[11px]" open={link?.phase === "diverge"}>
      <summary className="cursor-pointer text-muted hover:text-text">
        {check ? `Comparação de colunas${link && link.files.length > 1 ? ` · ${shown.file}` : ""}` : `Contrato: ${table.columns.length} colunas`}
      </summary>
      <ul className="mt-1.5 flex max-h-56 flex-col gap-0.5 overflow-y-auto font-mono">
        {(check?.columns ?? table.columns.map((c) => ({ ...c, source: null, sourceType: null, status: null }))).map((c) => {
          const s = c.status ? STATUS_ICON[c.status] : null;
          return (
            <li key={c.name} className="flex items-center justify-between gap-2" title={s ? `${s.label}${c.source && c.source !== c.name ? ` (no arquivo: ${c.source})` : ""}` : undefined}>
              <span className={c.required ? "" : "text-muted"}>
                {s && <span className={`mr-1 ${s.tone}`}>{s.icon}</span>}
                {c.name}
              </span>
              <span className="text-muted">{c.sourceType ? `${c.sourceType.toLowerCase()} → ${c.type}` : c.type}</span>
            </li>
          );
        })}
      </ul>
      {check && check.extras.length > 0 && <p className="mt-1 text-muted">Sobrando no arquivo (ignoradas): {check.extras.join(", ")}</p>}
    </details>
  );
}

/** What is wrong with each file that cannot be engaged (its columns diverge, or it could not be read). */
function Refused({ link, onRetry }: { link: Link; onRetry: () => void }) {
  const bad = link.files.filter((f) => f.state === "diverge" || f.state === "failed");
  const many = link.files.length > 1;
  const problems = (f: LinkFile): string[] => (f.state === "diverge" ? f.check?.errors ?? [] : [f.note ?? "Não foi possível ler o arquivo."]);
  return (
    <div className="text-xs text-danger">
      <p className="font-semibold">
        {many
          ? `⚠ ${bad.length} de ${link.files.length} arquivos não servem — tire-os da lista ou corrija para engatar`
          : link.phase === "diverge" ? `⚠ ${problems(bad[0]).length} divergência(s) — não dá para engatar` : `✕ ${problems(bad[0])[0]}`}
      </p>
      {bad.filter(() => many || link.phase === "diverge").map((f) => (
        <div key={pathOf(f)}>
          {many && <p className="mt-1 font-mono font-semibold">{f.file}</p>}
          <ul className="list-disc pl-4">{problems(f).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      ))}
      {bad.some((f) => f.state === "failed") && <button type="button" onClick={onRetry} className="font-semibold hover:underline">Verificar de novo</button>}
    </div>
  );
}

function LinkStatus({ link, onEngage, onRetry }: { link: Link; onEngage: () => void; onRetry: () => void }) {
  const [first] = link.files;
  const many = link.files.length > 1;
  switch (link.phase) {
    case "suggested":
      return <p className="text-xs text-muted">Sugestão pelo nome: <b className="font-mono">{first.file}</b>. <button type="button" onClick={onRetry} className="font-semibold text-brand-2 hover:underline">Verificar colunas</button></p>;
    case "checking": {
      const pending = link.files.filter((f) => f.state === "checking").length;
      return <p className="animate-pulse text-xs text-brand-2">Lendo as colunas de {many ? `${pending} de ${link.files.length} arquivos` : first.file}…</p>;
    }
    case "ok": {
      const required = first.check?.columns.filter((c) => c.required) ?? [];
      const fine = required.filter((c) => c.status !== "missing").length;
      const converts = first.check?.columns.filter((c) => c.status === "convert").length ?? 0;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-ok">
            ✓ {many ? `${link.files.length} arquivos conferidos: as colunas batem` : `${fine}/${required.length} colunas batem`}
            {converts > 0 ? ` · ${converts} serão convertidas` : ""}
          </p>
          <button type="button" onClick={onEngage} className="btn btn-primary px-3 py-1 text-xs">⚡ {many ? `Unir e engatar ${link.files.length} arquivos` : "Engatar"}</button>
        </div>
      );
    }
    case "engaging":
      return <p className="animate-pulse text-xs text-brand-2">{link.note ?? `Engatando ${many ? `${link.files.length} arquivos` : first.file}`}…</p>;
    case "engaged":
      return (
        <p className="text-xs font-semibold text-ok">
          🎉 Engatado! {link.report ? rows(link.report.rowCount) : ""} de {many ? `${link.files.length} arquivos` : first.file}
          {link.report && link.report.warnings.length > 0 && <span className="block font-normal text-accent">{link.report.warnings[0]}</span>}
        </p>
      );
    case "diverge":
      return <Refused link={link} onRetry={onRetry} />;
    case "failed":
      // A note on the wire itself is a refused engage (the files had passed the check).
      if (link.note === undefined) return <Refused link={link} onRetry={onRetry} />;
      return (
        <div className="text-xs text-danger">
          <p>✕ {link.note}</p>
          <button type="button" onClick={onEngage} className="font-semibold hover:underline">Engatar de novo</button>
        </div>
      );
  }
}

interface TableNodeProps {
  table: ConnectorTable;
  link: Link | undefined;
  canUpload: boolean;
  /** Fact table only: right-hand port wired to the data filter column. */
  outPortRef?: (el: HTMLSpanElement | null) => void;
  /** The data filter has saved rules (lights the right-hand port). */
  filtered?: boolean;
  /** Opens the organization's file explorer to choose this table's file(s). */
  onChooseFile: () => void;
  onEngage: (link: Link) => void;
  /** Checks again the files that are not ready (a suggestion, or one that could not be read). */
  onRetry: (link: Link) => void;
  onRemoveFile: (file: FilePick) => void;
  onDisconnect: () => void;
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const ACTION = "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50";

/**
 * One contract table: the stored file(s) it is related to (chosen in the organization's file explorer —
 * files are sent there, not here; several files are joined into the table), the column check and the contract.
 */
export function TableNode({ table, link, canUpload, outPortRef, filtered, onChooseFile, onEngage, onRetry, onRemoveFile, onDisconnect }: TableNodeProps) {
  const phase = link?.phase;
  const busy = phase === "engaging" || phase === "checking";
  const chosen = link !== undefined && phase !== "suggested";
  const ring =
    phase === "engaged" ? "border-ok/70" : phase === "diverge" || phase === "failed" ? "border-danger/60" : "border-line";

  return (
    <div
      data-table={table.name}
      className={`relative rounded-xl border bg-card p-3 transition ${ring} ${phase === "engaged" ? "dbi-pop" : ""} ${phase === "diverge" ? "dbi-shake" : ""}`}
    >
      {outPortRef && (
        <span ref={outPortRef} className={`absolute -right-[7px] top-6 size-3 rounded-full border-2 bg-bg ${filtered ? "border-brand bg-brand" : "border-line"}`} aria-hidden />
      )}
      {phase === "engaged" && <Confetti key={`${link?.files.length}-${link?.report?.rowCount}`} />}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <code className={`truncate font-mono text-sm font-bold ${table.kind === "fact" ? "text-brand-2" : ""}`}>{table.name}</code>
            <span className="rounded border border-line px-1 text-[9px] uppercase tracking-wider text-muted">{table.kind === "fact" ? "fato" : "dimensão"}</span>
          </div>
          <p className={`text-[11px] ${table.status.tone === "ok" ? "text-ok" : table.status.tone === "draft" ? "text-brand-2" : "text-muted"}`}>{table.status.label}</p>
        </div>
        <span className="shrink-0 p-1"><Coupler phase={phase} /></span>
      </div>

      {link && (
        <>
          <Files link={link} busy={busy} onRemove={onRemoveFile} />
          <div className="mt-1.5 flex items-start justify-between gap-2">
            <LinkStatus link={link} onEngage={() => onEngage(link)} onRetry={() => onRetry(link)} />
            {!busy && (
              <button type="button" onClick={onDisconnect} title={link.files.length > 1 ? "Tirar todos os arquivos" : "Desconectar"} aria-label={`Desconectar ${table.name}`} className="text-muted hover:text-danger">×</button>
            )}
          </div>
        </>
      )}

      {canUpload && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onChooseFile} disabled={busy} className={`${ACTION} border-brand/40 bg-brand/5 text-brand-2 hover:border-brand hover:bg-brand/10`}>
            <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> {chosen ? "Adicionar arquivo" : "Escolher arquivos"}
          </button>
          {!link && <span className="text-[11px] text-muted">Um ou mais arquivos já guardados no armazenamento; vários são unidos numa tabela só.</span>}
        </div>
      )}
      <Columns table={table} link={link} />
    </div>
  );
}

