"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadAnalysisAction } from "./section-actions";

interface LazySectionProps {
  /** Signed by the page: which dashboard this reader was given (see lib/section-ticket). */
  ticket: string;
  analysisId: string;
  /** The page's filters and picked items, as a query string. */
  search: string;
  anchor: string;
  /** Title and description of the analysis: on screen from the start, so the page has its outline. */
  header: React.ReactNode;
}

type State =
  | { status: "idle" | "loading" | "error" }
  /** `body` is null when the analysis has nothing to show under these filters. */
  | { status: "done"; body: React.ReactNode | null };

/**
 * An analysis starts loading a screen or so before the reader scrolls down to it, so it is usually ready
 * on arrival. Only downwards: what is above the screen waits until it is really on screen. Otherwise a
 * jump from the summary would load the analyses just above the target, and their growing would push the
 * target away from where the reader landed. The strip at the top of the screen does not count either: a
 * jump leaves the title a little below the top (scroll-mt), with the tail of the previous analysis above it.
 */
const AHEAD = "-140px 0px 700px 0px";

/** A change this small in where the end of the analysis sits is not worth correcting (rounding, fonts). */
const NOTICEABLE_PX = 2;

const BLOCK = "animate-pulse rounded-lg bg-text/10";

function Waiting() {
  return (
    <div role="status" aria-label="Carregando a análise" className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-12">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card p-5 md:col-span-3">
          <div className={`${BLOCK} h-3 w-24`} />
          <div className={`${BLOCK} mt-4 h-9 w-3/4`} />
        </div>
      ))}
      <div className="card p-5 sm:col-span-2 md:col-span-12">
        <div className={`${BLOCK} h-3 w-32`} />
        <div className={`${BLOCK} mt-4 h-56`} />
      </div>
    </div>
  );
}

/**
 * An analysis the page did not compute when it opened. Its title is there from the start; its visuals
 * are asked for when the reader gets near it (scrolling, or jumping from the summary) and take the
 * skeleton's place. A dashboard with dozens of analyses then opens as fast as its first one.
 */
export function LazySection({ ticket, analysisId, search, anchor, header }: LazySectionProps) {
  const ref = useRef<HTMLElement>(null);
  /** Marks where the analysis ends, also when it leaves the page (nothing to show). */
  const end = useRef<HTMLDivElement>(null);
  /** Where the analysis started and ended on screen just before the visuals took the skeleton's place. */
  const before = useRef<{ top: number; end: number } | null>(null);
  const [state, setState] = useState<State>({ status: "idle" });

  useEffect(() => {
    if (state.status !== "idle") return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setState({ status: "loading" });
      },
      { rootMargin: AHEAD },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "loading") return;
    let current = true;
    loadAnalysisAction(ticket, analysisId, search)
      .then((answer) => {
        if (!current) return;
        const top = ref.current?.getBoundingClientRect().top;
        const bottom = end.current?.getBoundingClientRect().top;
        before.current = top === undefined || bottom === undefined ? null : { top, end: bottom };
        setState(answer.ok ? { status: "done", body: answer.body } : { status: "error" });
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [state.status, ticket, analysisId, search]);

  // The visuals rarely have the skeleton's height. When the analysis starts above the screen, the reader
  // came from below (scrolling up, or having jumped to the next one): what they see is its end and what
  // follows, and that must not move — so the page is scrolled by how much the end shifted.
  // After the frame, so a browser that already kept the place by itself is left alone.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (state.status !== "done" || was === null || was.top >= 0) return;
    const frame = requestAnimationFrame(() => {
      const after = end.current?.getBoundingClientRect().top;
      if (after !== undefined && Math.abs(after - was.end) > NOTICEABLE_PX) window.scrollBy({ top: after - was.end, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);

  // Nothing to show under these filters: the analysis leaves the page, as it does when computed with it.
  const gone = state.status === "done" && state.body === null;

  return (
    <>
      {!gone && (
        <section
          ref={ref}
          id={anchor}
          aria-labelledby={`${anchor}-titulo`}
          aria-busy={state.status === "loading" || undefined}
          className="mt-14 scroll-mt-24 first:mt-0"
        >
          {header}
          {state.status === "done" && state.body}
          {(state.status === "idle" || state.status === "loading") && <Waiting />}
          {state.status === "error" && (
            <div className="card flex flex-wrap items-center gap-3 p-5 text-sm">
              <p className="text-muted">Não foi possível carregar esta análise.</p>
              <button type="button" onClick={() => setState({ status: "loading" })} className="rounded-md border border-line px-3 py-1 hover:bg-text/5">
                Tentar de novo
              </button>
              <span className="text-xs text-muted">Se continuar, recarregue a página.</span>
            </div>
          )}
        </section>
      )}
      <div ref={end} aria-hidden />
    </>
  );
}
