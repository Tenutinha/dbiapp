"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { PUSH_IDLE_MS, PUSH_START, pushOnWheel, pushProgress, type PushState } from "@/lib/layout/overscroll";
import { rememberLandAtEnd } from "./jump";
import { useSwitchSignal } from "./switching";
import { selectDashboardAction } from "./view-actions";

interface NextDashboardProps {
  id: string;
  name: string;
  number: number;
  /** Public link (no account): opens this address instead of the signed-in action. */
  href?: string;
  /**
   * "previous" is the opening block of a dashboard: the one before it in the summary, opened by scrolling
   * up past the top of the page (it then lands at its end, as if the reading went on backwards).
   */
  direction?: "next" | "previous";
}

/** Upward finger travel (px) at the page end that opens the next dashboard on touch screens. */
const TOUCH_PULL = 140;

const atPageEnd = (): boolean => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
const atPageStart = (): boolean => window.scrollY <= 2;

/**
 * Closing block of a dashboard: the next one in the summary. It opens with a click, or by itself when the
 * reader keeps scrolling past the end of the page. The current dashboard stays on screen until the next
 * one is ready (a transition), so the change never shows an empty page.
 */
export function NextDashboard({ id, name, number, href, direction = "next" }: NextDashboardProps) {
  const back = direction === "previous";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The coming dashboard takes the screen (as a skeleton) the moment it is asked for.
  useSwitchSignal(pending, name);
  const [progress, setProgress] = useState(0);
  const push = useRef<PushState>(PUSH_START);
  const opened = useRef(false);

  const open = (): void => {
    if (opened.current) return;
    opened.current = true;
    if (back) rememberLandAtEnd();
    if (href) {
      startTransition(() => router.push(href));
      return;
    }
    startTransition(async () => {
      const target = await selectDashboardAction(id);
      // After the await, the navigation must join the transition again to keep it pending.
      if (target !== null) startTransition(() => router.push(target));
    });
  };
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  // The action came back without changing the screen (dashboard no longer visible): allow another try.
  useEffect(() => {
    if (!pending) opened.current = false;
  }, [pending]);

  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent): void => {
      // Going back is the same push, mirrored: at the top of the page, wheel upwards.
      const input = back ? { atEnd: atPageStart(), deltaY: -e.deltaY } : { atEnd: atPageEnd(), deltaY: e.deltaY };
      const r = pushOnWheel(push.current, { ...input, now: performance.now() });
      push.current = r.state;
      setProgress(pushProgress(r.state));
      if (r.open) openRef.current();
      // A pause starts the push over (pushOnWheel): show it, so the line (and the popup above) goes away.
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (opened.current) return;
        push.current = { ...push.current, pushed: 0 };
        setProgress(0);
      }, PUSH_IDLE_MS);
    };
    let startY: number | null = null;
    // On touch screens pulling down at the top belongs to the browser (reload): going back is by tap only.
    const onTouchStart = (e: TouchEvent): void => {
      startY = !back && atPageEnd() ? (e.touches[0]?.clientY ?? null) : null;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY;
      if (back || startY === null || y === undefined || !atPageEnd()) return;
      const pulled = Math.max(0, startY - y);
      setProgress(Math.min(pulled / TOUCH_PULL, 1));
      if (pulled >= TOUCH_PULL) openRef.current();
    };
    const onTouchEnd = (): void => {
      startY = null;
      if (!opened.current) setProgress(0);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      clearTimeout(idle);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [back]);

  const shown = pending ? 1 : progress;
  if (back) {
    // A popup centred under the dashboard header, shown only while the reader pushes upwards at the top of
    // the page (or the keyboard focus reaches it): it takes no room on the page.
    const visible = shown > 0;
    return (
      <div className="relative h-0">
        <button
          type="button"
          onClick={open}
          aria-busy={pending || undefined}
          className={`group absolute left-1/2 top-0 z-30 w-max max-w-[min(90vw,32rem)] -translate-x-1/2 rounded-full border border-line bg-card px-4 py-2 text-left shadow-lg transition-opacity duration-150 focus-visible:opacity-100 ${
            visible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <span className="flex items-baseline gap-3">
            <span className="min-w-0 truncate font-mono text-xs text-muted transition-colors group-hover:text-text">
              {pending ? "Abrindo…" : "↑ Anterior · continue rolando para cima"} · <span className="text-text">{name}</span>
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{String(number).padStart(2, "0")}</span>
          </span>
          <span className="mt-1.5 block h-0.5 w-full overflow-hidden rounded-full bg-line" aria-hidden>
            <span
              className={`block h-full origin-left bg-brand transition-transform duration-150 ease-out ${pending ? "animate-pulse" : ""}`}
              style={{ transform: `scaleX(${shown})` }}
            />
          </span>
        </button>
      </div>
    );
  }
  // The next dashboard already shows as a band of another colour (a tint of the dashboard header's), from the
  // sidebar to the window's edge and down to its bottom: the reader sees that pushing on leads elsewhere.
  // The tint deepens as the push goes on. The box-shadow + clip-path pair paints the band past the centred
  // column without widening the page.
  const tint = `color-mix(in srgb, var(--color-header) ${Math.round(12 + 28 * shown)}%, var(--color-bg))`;
  return (
    <button
      type="button"
      onClick={open}
      aria-busy={pending || undefined}
      style={{ background: tint, boxShadow: `0 0 0 100vmax ${tint}`, clipPath: "inset(0 -100vmax -100vmax)" }}
      className={`group relative mt-16 -mb-16 block min-h-[38vh] w-full pb-16 pt-10 text-left transition-[background,box-shadow] duration-150 ease-out ${
        pending ? "animate-pulse" : ""
      }`}
    >
      <span className="block font-mono text-xs text-muted">{pending ? "Abrindo…" : "A seguir · continue rolando ↓"}</span>
      <span className="mt-1 flex items-baseline justify-between gap-4">
        <span className="font-serif text-3xl leading-tight tracking-[-0.01em] text-text/80 transition-colors group-hover:text-text sm:text-4xl">
          {name}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{String(number).padStart(2, "0")}</span>
      </span>
    </button>
  );
}
