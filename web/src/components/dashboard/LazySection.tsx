"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StaleProvider, useLive } from "./live";
import type { PartAnswer } from "./live-types";
import { nextLoad, type PartState } from "./part-state";
import { loadAnalysisAction } from "./section-actions";

interface LazySectionProps {
  /** Signed by the page: which dashboard this reader was given (see lib/section-ticket). */
  ticket: string;
  /** The analysis, or "" for the visuals of the page that belong to none. */
  analysisId: string;
  /** The page's filters and picked items when it was made, as a query string. */
  search: string;
  /** Where the summary jumps to; none for the visuals outside the analyses (a plain block, not a section). */
  anchor?: string;
  /** Title and description of the analysis: on screen from the start, so the page has its outline. */
  header?: React.ReactNode;
  /** What the page already computed for `search` (null: nothing to show). Left out: asked for when the reader gets near. */
  initial?: { body: React.ReactNode | null };
  /** A page of a strip turned sideways (PageStrip): its own classes, and the page never scrolls to keep its end. */
  pageClass?: string;
  /** Classes of the section when it is not such a page (default: one analysis below the other, freely scrolled). */
  sectionClass?: string;
}

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
 * One part of a dashboard that keeps itself up to date: an analysis (or the visuals outside any).
 *
 * Its visuals come with the page (`initial`) or are asked for when the reader gets near it (scrolling, or
 * jumping from the summary), a skeleton holding the place meanwhile: a dashboard with dozens of analyses
 * opens as fast as its first one. When the selection changes (a filter, an item picked in a visual) the
 * part asks again, and again only when it is on screen or about to be; what it shows stays in place, marked
 * as on its way out, until the new numbers arrive. Nothing is unmounted, so the reader stays where they are.
 */
export function LazySection({ ticket, analysisId, search: pageSearch, anchor, header, initial, pageClass, sectionClass }: LazySectionProps) {
  const live = useLive();
  // Outside a live dashboard the selection only changes with the page itself.
  const search = live?.search ?? pageSearch;
  const ref = useRef<HTMLElement>(null);
  /** Marks where the part ends, also when it leaves the page (nothing to show). */
  const end = useRef<HTMLDivElement>(null);
  /** Where the part started and ended on screen just before new visuals took the place of what was there. */
  const before = useRef<{ top: number; end: number } | null>(null);
  const [state, setState] = useState<PartState<React.ReactNode | null>>(
    initial ? { loaded: pageSearch, body: initial.body, loading: null, failed: null } : { loaded: null, body: null, loading: null, failed: null },
  );
  const [near, setNear] = useState(false);

  // Its box comes and goes (nothing loaded yet, nothing to show): what is watched follows it.
  const never = state.loaded === null;
  const empty = state.body === null;
  // Near the screen or not, all the time: a part that scrolled away waits again when the selection changes.
  useEffect(() => {
    const seen = new Map<Element, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target, e.isIntersecting);
        setNear([...seen.values()].some(Boolean));
      },
      { rootMargin: AHEAD },
    );
    // The end mark too: a part with nothing to show has no box of its own to be seen.
    for (const el of [ref.current, end.current]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [never, empty]);

  // Back to the selection it already shows while asking for another: that answer is not waited for any more.
  const idle = state.loading !== null && state.loaded === search;
  useEffect(() => {
    if (idle) setState((s) => (s.loaded === search ? { ...s, loading: null } : s));
  }, [idle, search]);
  // A new ticket (the page was made again after the old one expired): what failed is asked again by itself.
  useEffect(() => {
    setState((s) => (s.failed === null ? s : { ...s, failed: null }));
  }, [ticket]);

  const wanted = nextLoad(state, search, near);
  useEffect(() => {
    if (wanted === null) return;
    setState((s) => ({ ...s, loading: wanted, failed: null }));
    const ask: Promise<PartAnswer> = live ? live.loadPart(analysisId, wanted) : loadAnalysisAction(ticket, analysisId, wanted);
    ask.then((answer) => answer, (): PartAnswer => ({ ok: false })).then((answer) => {
      const top = ref.current?.getBoundingClientRect().top;
      const bottom = end.current?.getBoundingClientRect().top;
      // An answer for a selection that is not the one waited for any more is dropped.
      setState((s) => {
        if (s.loading !== wanted) return s;
        before.current = top === undefined || bottom === undefined ? null : { top, end: bottom };
        return answer.ok ? { loaded: wanted, body: answer.body, loading: null, failed: null } : { ...s, loading: null, failed: wanted };
      });
    });
  }, [wanted, live, ticket, analysisId]);

  // The visuals rarely have the height of what they replace. When the part starts above the screen, the reader
  // came from below (scrolling up, or having jumped to the next one): what they see is its end and what
  // follows, and that must not move — so the page is scrolled by how much the end shifted.
  // After the frame, so a browser that already kept the place by itself is left alone.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (was === null || was.top >= 0 || pageClass !== undefined) return;
    const frame = requestAnimationFrame(() => {
      const after = end.current?.getBoundingClientRect().top;
      if (after !== undefined && Math.abs(after - was.end) > NOTICEABLE_PX) window.scrollBy({ top: after - was.end, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.loaded, state.body, pageClass]);

  const failed = state.failed === search;
  // Nothing to show under the selection it was computed for: the part leaves the page, as it does when
  // computed with it (and comes back by itself if another selection gives it something).
  const gone = !never && empty && !failed;
  const stale = !never && state.loaded !== search;
  const Box = anchor === undefined ? "div" : "section";

  return (
    <>
      {!gone && (
        <Box
          ref={ref as React.Ref<HTMLDivElement>}
          id={anchor}
          aria-labelledby={anchor === undefined ? undefined : `${anchor}-titulo`}
          aria-busy={state.loading !== null || undefined}
          className={anchor === undefined ? undefined : pageClass ?? sectionClass ?? "mt-14 scroll-mt-24 first:mt-0"}
        >
          {header}
          {!never && <StaleProvider value={stale}>{state.body}</StaleProvider>}
          {never && !failed && <Waiting />}
          {failed && (
            <div className="card flex flex-wrap items-center gap-3 p-5 text-sm">
              <p className="text-muted">Não foi possível {never ? "carregar" : "atualizar"} esta análise.</p>
              <button type="button" onClick={() => setState((s) => ({ ...s, failed: null }))} className="rounded-md border border-line px-3 py-1 hover:bg-text/5">
                Tentar de novo
              </button>
              <span className="text-xs text-muted">Se continuar, recarregue a página.</span>
            </div>
          )}
        </Box>
      )}
      <div ref={end} aria-hidden />
    </>
  );
}
