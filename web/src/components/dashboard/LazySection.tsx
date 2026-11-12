"use client";

import { useEffect, useRef, useState } from "react";
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

/** How far from the screen an analysis starts loading: it is usually ready when the reader gets there. */
const AHEAD = "700px 0px";

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
        if (current) setState(answer.ok ? { status: "done", body: answer.body } : { status: "error" });
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [state.status, ticket, analysisId, search]);

  // Nothing to show under these filters: the analysis leaves the page, as it does when computed with it.
  if (state.status === "done" && state.body === null) return null;

  return (
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
  );
}
