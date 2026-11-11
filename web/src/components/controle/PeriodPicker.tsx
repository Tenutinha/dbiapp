"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { shiftMonth } from "@/lib/controle/schema";
import {
  LAST_DAYS, MAX_MONTHS, monthChoices, periodLabel, periodQuery, singleMonth, type Period,
} from "@/lib/controle/period";

interface PeriodPickerProps {
  /** The screen's own address (/<org>/<cliente>/controle). */
  base: string;
  period: Period;
  today: string;
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ARROW = "grid size-10 place-items-center rounded-lg text-xl text-muted hover:bg-text/5";

/**
 * The period of the screen: the ‹ › arrows walk one month at a time; the label opens a box with
 * the last 7/15/30/45 days and the months ("competências"), several at once.
 */
export function PeriodPicker({ base, period, today }: PeriodPickerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(period.kind === "months" ? period.months : []);
  const box = useRef<HTMLDivElement>(null);
  const currentMonth = today.slice(0, 7);
  const href = (p: Period): string => {
    const q = periodQuery(p, currentMonth);
    return q ? `${base}?${q}` : base;
  };
  const single = singleMonth(period);
  const periodKey = JSON.stringify(period);

  // A new period on screen: the box closes and starts from it.
  useEffect(() => {
    const current = JSON.parse(periodKey) as Period;
    setOpen(false);
    setChosen(current.kind === "months" ? current.months : []);
  }, [periodKey]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (month: string): void =>
    setChosen((list) => (list.includes(month) ? list.filter((m) => m !== month) : [...list, month].sort().slice(-MAX_MONTHS)));

  const apply = (): void => {
    if (chosen.length === 0) return;
    router.push(href({ kind: "months", months: [...chosen].sort() }));
  };

  return (
    <div ref={box} className="relative -ml-2 flex shrink-0 items-center justify-between sm:ml-0">
      {single ? (
        <Link href={href({ kind: "months", months: [shiftMonth(single, -1)] })} aria-label="Mês anterior" className={ARROW}>‹</Link>
      ) : (
        <span className="size-10" aria-hidden />
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Escolher o período"
        className="flex min-w-24 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold transition first-letter:uppercase hover:bg-text/5"
      >
        <span className="first-letter:uppercase">{periodLabel(period)}</span>
        <span aria-hidden className="text-[10px] text-muted">▾</span>
      </button>
      {/* Entries may be dated ahead, so the months to come are reachable too. */}
      {single ? (
        <Link href={href({ kind: "months", months: [shiftMonth(single, 1)] })} aria-label="Próximo mês" className={ARROW}>›</Link>
      ) : (
        <span className="size-10" aria-hidden />
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Escolher o período"
          className="absolute right-0 top-full z-30 mt-1 flex w-72 flex-col gap-3 rounded-xl border border-line bg-card p-3 shadow-xl"
        >
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted">Últimos dias</p>
            <div className="grid grid-cols-4 gap-1.5">
              {LAST_DAYS.map((days) => {
                const on = period.kind === "days" && period.days === days;
                return (
                  <Link
                    key={days}
                    href={href({ kind: "days", days })}
                    aria-current={on ? "true" : undefined}
                    className={`rounded-lg border px-2 py-1.5 text-center text-xs transition ${on ? "border-brand bg-brand/10 font-semibold" : "border-line hover:bg-text/5"}`}
                  >
                    {days} dias
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="border-t border-line pt-3">
            <div className="mb-1.5 flex items-baseline justify-between">
              <p className="text-xs font-semibold text-muted">Competências</p>
              {chosen.length > 0 && (
                <button type="button" onClick={() => setChosen([])} className="text-[11px] text-muted hover:text-text">Limpar</button>
              )}
            </div>
            <ul className="scroll-quiet max-h-56 overflow-y-auto pr-1">
              {monthChoices(today).map((month) => {
                const [year, m] = month.split("-");
                return (
                  <li key={month}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-text/5">
                      <input type="checkbox" checked={chosen.includes(month)} onChange={() => toggle(month)} />
                      <span className="flex-1 first-letter:uppercase">{MONTH_NAMES[Number(m) - 1]} de {year}</span>
                      {month === currentMonth && <span className="text-[10px] text-muted">atual</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={apply}
              disabled={chosen.length === 0}
              className="btn btn-primary mt-2 w-full py-1.5 text-sm disabled:opacity-40"
            >
              {chosen.length > 1 ? `Ver ${chosen.length} competências` : "Ver competência"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
