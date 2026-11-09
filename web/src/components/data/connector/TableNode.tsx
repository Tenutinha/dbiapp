"use client";

import { useMemo, useRef, useState } from "react";
import type { ColumnStatus } from "@/lib/ingest/schema-check";
import type { ConnectorTable, Link } from "./types";

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

function Columns({ table, link }: { table: ConnectorTable; link: Link | undefined }) {
  const check = link?.check;
  return (
    <details className="mt-2 text-[11px]" open={link?.phase === "diverge"}>
      <summary className="cursor-pointer text-muted hover:text-text">
        {check ? "Comparação de colunas" : `Contrato: ${table.columns.length} colunas`}
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

function LinkStatus({ link, onEngage, onRetry }: { link: Link; onEngage: () => void; onRetry: () => void }) {
  const total = link.check?.columns.filter((c) => c.required).length ?? 0;
  const fine = link.check?.columns.filter((c) => c.required && c.status !== "missing").length ?? 0;
  const converts = link.check?.columns.filter((c) => c.status === "convert").length ?? 0;
  switch (link.phase) {
    case "suggested":
      return <p className="text-xs text-muted">Sugestão pelo nome: <b className="font-mono">{link.file}</b>. <button type="button" onClick={onRetry} className="font-semibold text-brand-2 hover:underline">Verificar colunas</button></p>;
    case "checking":
      return <p className="animate-pulse text-xs text-brand-2">Lendo as colunas de {link.file}…</p>;
    case "ok":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-ok">✓ {fine}/{total} colunas batem{converts > 0 ? ` · ${converts} serão convertidas` : ""}</p>
          <button type="button" onClick={onEngage} className="btn btn-primary px-3 py-1 text-xs">⚡ Engatar</button>
        </div>
      );
    case "diverge":
      return (
        <div className="text-xs text-danger">
          <p className="font-semibold">⚠ {link.check?.errors.length ?? 0} divergência(s) — não dá para engatar</p>
          <ul className="list-disc pl-4">{link.check?.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      );
    case "engaging":
      return <p className="animate-pulse text-xs text-brand-2">{link.note ?? "Engatando"} {link.file}…</p>;
    case "engaged":
      return (
        <p className="text-xs font-semibold text-ok">
          🎉 Engatado! {link.report?.rowCount.toLocaleString("pt-BR")} linhas de {link.file}
          {link.report && link.report.warnings.length > 0 && <span className="block font-normal text-accent">{link.report.warnings[0]}</span>}
        </p>
      );
    case "failed":
      return (
        <div className="text-xs text-danger">
          <p>✕ {link.note}</p>
          {!link.uploaded && <button type="button" onClick={onRetry} className="font-semibold hover:underline">Verificar de novo</button>}
        </div>
      );
  }
}

interface TableNodeProps {
  table: ConnectorTable;
  link: Link | undefined;
  /** A file is picked (click-to-connect) or dragged: this node is a drop target. */
  awaiting: boolean;
  canUpload: boolean;
  portRef: (el: HTMLSpanElement | null) => void;
  /** Fact table only: right-hand port wired to the data filter column. */
  outPortRef?: (el: HTMLSpanElement | null) => void;
  /** The data filter has saved rules (lights the right-hand port). */
  filtered?: boolean;
  onPick: () => void;
  onEngage: (link: Link) => void;
  onRetry: (link: Link) => void;
  onDisconnect: () => void;
  onUpload: (file: File) => void;
}

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
    </svg>
  );
}

/** Right column: one contract table with its socket (port), plug (upload), wire status and columns. */
export function TableNode({ table, link, awaiting, canUpload, portRef, outPortRef, filtered, onPick, onEngage, onRetry, onDisconnect, onUpload }: TableNodeProps) {
  const input = useRef<HTMLInputElement>(null);
  const phase = link?.phase;
  // A file from the computer is being dragged over this table.
  const [dropping, setDropping] = useState(false);
  const canDrop = canUpload && phase !== "engaging";
  const pickFile = (e: React.MouseEvent): void => {
    e.stopPropagation();
    input.current?.click();
  };
  const ring =
    dropping ? "border-brand border-dashed bg-brand/5" : phase === "engaged" ? "border-ok/70" : phase === "diverge" || phase === "failed" ? "border-danger/60" : awaiting ? "border-brand border-dashed" : "border-line";

  return (
    <div
      data-table={table.name}
      onClick={awaiting ? onPick : undefined}
      onDragOver={(e) => {
        if (!canDrop || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!canDrop || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        setDropping(false);
        onUpload(e.dataTransfer.files[0]);
      }}
      className={`relative rounded-xl border bg-card p-3 transition ${ring} ${awaiting ? "cursor-copy hover:bg-brand/5" : ""} ${phase === "engaged" ? "dbi-pop" : ""} ${phase === "diverge" ? "dbi-shake" : ""}`}
    >
      <span ref={portRef} className={`absolute -left-[7px] top-6 size-3 rounded-full border-2 bg-bg ${phase === "engaged" ? "border-ok bg-ok" : link ? "border-brand" : "border-line"}`} aria-hidden />
      {outPortRef && (
        <span ref={outPortRef} className={`absolute -right-[7px] top-6 size-3 rounded-full border-2 bg-bg ${filtered ? "border-brand bg-brand" : "border-line"}`} aria-hidden />
      )}
      {phase === "engaged" && <Confetti key={`${link?.file}-${link?.report?.rowCount}`} />}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <code className={`truncate font-mono text-sm font-bold ${table.kind === "fact" ? "text-brand-2" : ""}`}>{table.name}</code>
            <span className="rounded border border-line px-1 text-[9px] uppercase tracking-wider text-muted">{table.kind === "fact" ? "fato" : "dimensão"}</span>
          </div>
          <p className={`text-[11px] ${table.status.tone === "ok" ? "text-ok" : table.status.tone === "draft" ? "text-brand-2" : "text-muted"}`}>{table.status.label}</p>
        </div>
        <button
          type="button"
          disabled={!canUpload || phase === "engaging"}
          onClick={pickFile}
          title="Enviar um arquivo do computador para esta tabela"
          aria-label={`Enviar um arquivo para ${table.name}`}
          className="shrink-0 rounded-lg p-1 transition hover:bg-text/5 disabled:opacity-50"
        >
          <Coupler phase={phase} />
        </button>
        <input
          ref={input}
          type="file"
          accept=".parquet,.csv,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      {link ? (
        <div className="mt-2 flex items-start justify-between gap-2">
          <LinkStatus link={link} onEngage={() => onEngage(link)} onRetry={() => onRetry(link)} />
          {phase !== "engaging" && phase !== "checking" && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onDisconnect(); }} title="Desconectar" aria-label={`Desconectar ${table.name}`} className="text-muted hover:text-danger">×</button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            {awaiting ? "Clique para conectar aqui" : dropping ? "Solte para enviar este arquivo" : "Solte aqui um arquivo do computador ou da pasta ao lado"}
          </p>
          {canUpload && !awaiting && (
            <button
              type="button"
              onClick={pickFile}
              disabled={phase === "engaging"}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/5 px-2.5 py-1 text-xs font-semibold text-brand-2 transition hover:border-brand hover:bg-brand/10 disabled:opacity-50"
            >
              <UploadIcon /> Enviar arquivo
            </button>
          )}
        </div>
      )}
      <Columns table={table} link={link} />
    </div>
  );
}
