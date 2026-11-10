"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { PUSH_START, pushOnWheel, pushProgress, type PushState } from "@/lib/layout/overscroll";
import { openDashboardAction } from "./view-actions";

interface NextDashboardProps {
  id: string;
  name: string;
  number: number;
}

/** Upward finger travel (px) at the page end that opens the next dashboard on touch screens. */
const TOUCH_PULL = 140;

const atPageEnd = (): boolean => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;

/**
 * Closing block of a dashboard: the next one in the summary. It opens with a click, or by itself when the
 * reader keeps scrolling past the end of the page. The current dashboard stays on screen until the next
 * one is ready (a transition), so the change never shows an empty page.
 */
export function NextDashboard({ id, name, number }: NextDashboardProps) {
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState(0);
  const push = useRef<PushState>(PUSH_START);
  const opened = useRef(false);

  const open = (): void => {
    if (opened.current) return;
    opened.current = true;
    const data = new FormData();
    data.set("id", id);
    startTransition(async () => {
      await openDashboardAction(data);
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
    const onWheel = (e: WheelEvent): void => {
      const r = pushOnWheel(push.current, { atEnd: atPageEnd(), deltaY: e.deltaY, now: performance.now() });
      push.current = r.state;
      setProgress(pushProgress(r.state));
      if (r.open) openRef.current();
    };
    let startY: number | null = null;
    const onTouchStart = (e: TouchEvent): void => {
      startY = atPageEnd() ? (e.touches[0]?.clientY ?? null) : null;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY;
      if (startY === null || y === undefined || !atPageEnd()) return;
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
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const shown = pending ? 1 : progress;
  return (
    <button type="button" onClick={open} aria-busy={pending || undefined} className="group mt-16 block w-full pb-10 text-left">
      <span className="block h-px w-full bg-line" aria-hidden>
        <span
          className={`block h-px origin-left bg-text transition-transform duration-150 ease-out ${pending ? "animate-pulse" : ""}`}
          style={{ transform: `scaleX(${shown})` }}
        />
      </span>
      <span className="mt-6 block font-mono text-xs text-muted">{pending ? "Abrindo…" : "A seguir · continue rolando"}</span>
      <span className="mt-1 flex items-baseline justify-between gap-4">
        <span className="font-serif text-3xl leading-tight tracking-[-0.01em] text-text/80 transition-colors group-hover:text-text sm:text-4xl">
          {name}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{String(number).padStart(2, "0")}</span>
      </span>
    </button>
  );
}
