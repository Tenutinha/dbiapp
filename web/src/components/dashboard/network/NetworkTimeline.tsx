"use client";

import { formatValue } from "@/lib/format";
import type { TimelinePeriod } from "@/lib/network-timeline";
import type { ValueFormat } from "@/lib/templates/schema";

interface TimelineProps {
  periods: readonly TimelinePeriod[];
  /** The period on the map; null: all of them. */
  value: string | null;
  onChange: (key: string | null) => void;
  playing: boolean;
  onPlay: (playing: boolean) => void;
  format: ValueFormat;
  measureLabel: string;
}

/**
 * The timeline over the map: one bar per period, as tall as its total. A click shows that period alone,
 * "Todos" the whole time span, and ▶ plays the periods in order.
 */
export function NetworkTimeline({ periods, value, onChange, playing, onPlay, format, measureLabel }: TimelineProps) {
  const max = Math.max(1, ...periods.map((p) => p.total));
  const button = "rounded-md px-2 py-1 text-xs font-medium transition hover:bg-text/10";
  return (
    <div
      role="group" aria-label="Linha do tempo"
      className="pointer-events-auto flex min-w-0 items-end gap-2 rounded-xl border border-line/70 bg-card/85 px-2.5 py-2 shadow-xl backdrop-blur-md"
    >
      <button
        type="button" onClick={() => onPlay(!playing)} aria-pressed={playing}
        className={`${button} grid size-8 shrink-0 place-items-center self-center bg-brand/15 text-brand hover:bg-brand/25`}
        aria-label={playing ? "Pausar" : "Reproduzir mês a mês"} title={playing ? "Pausar" : "Reproduzir mês a mês"}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden><path fill="currentColor" d="M4 3h3v10H4zM9 3h3v10H9z" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden><path fill="currentColor" d="M5 3l8 5-8 5z" /></svg>
        )}
      </button>
      <button
        type="button" onClick={() => { onPlay(false); onChange(null); }} aria-pressed={value === null}
        className={`${button} shrink-0 self-center ${value === null ? "bg-text/10 text-text" : "text-muted"}`}
      >
        Todos
      </button>
      <ol className="scroll-quiet flex min-w-0 items-end gap-1 overflow-x-auto">
        {periods.map((p) => {
          const on = value === p.key;
          return (
            <li key={p.key} className="shrink-0">
              <button
                type="button" onClick={() => { onPlay(false); onChange(on ? null : p.key); }} aria-pressed={on}
                title={`${p.title}: ${formatValue(p.total, format)} (${measureLabel.toLowerCase()})`}
                className={`group flex w-11 flex-col items-center gap-1 rounded-md px-1 pb-0.5 pt-1 transition hover:bg-text/10 ${on ? "bg-text/10" : ""}`}
              >
                <span className="flex h-7 w-full items-end justify-center">
                  <span
                    className={`w-4 rounded-t-sm transition-colors ${on ? "bg-brand" : value === null ? "bg-brand/55 group-hover:bg-brand/80" : "bg-muted/40 group-hover:bg-brand/60"}`}
                    style={{ height: `${Math.max(8, (p.total / max) * 100)}%` }}
                  />
                </span>
                <span className={`text-[10px] leading-none tabular-nums ${on ? "font-semibold text-text" : "text-muted"}`}>{p.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
