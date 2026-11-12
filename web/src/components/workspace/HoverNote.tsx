"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** A short pause before showing, so passing the mouse down the summary does not flash every note. */
const SHOW_DELAY_MS = 250;
/** Room between the summary item and the note, and kept from the window's edges. */
const GAP = 12;
const NOTE_WIDTH = 320;

interface Spot {
  left: number;
  top: number;
}

interface HoverNoteProps {
  /** What the item is about; nothing to show leaves the item as it is. */
  note?: string | null;
  children: React.ReactNode;
}

/**
 * The description of a summary item (a dashboard or one of its analyses), shown beside the sidebar
 * while the mouse rests on the item or the keyboard focus is in it. Drawn over the page (fixed, in a
 * portal), so the sidebar's own scroll never cuts it.
 */
export function HoverNote({ note, children }: HoverNoteProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!note) return <>{children}</>;

  const place = (): void => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(rect.right + GAP, window.innerWidth - NOTE_WIDTH - GAP);
    // Narrow screens (sidebar over the page): no room beside it, so the note stays hidden.
    if (left < rect.right) return;
    setSpot({ left, top: Math.max(GAP, Math.min(rect.top - 4, window.innerHeight - 160)) });
  };
  const show = (delay: number): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(place, delay);
  };
  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current);
    setSpot(null);
  };

  return (
    <div
      ref={box}
      aria-describedby={spot ? id : undefined}
      onMouseEnter={() => show(SHOW_DELAY_MS)}
      onMouseLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
      onClick={hide}
    >
      {children}
      {spot &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{ left: spot.left, top: spot.top, width: NOTE_WIDTH }}
            className="dash-enter pointer-events-none fixed z-50 rounded-lg border border-paper-line bg-paper px-3.5 py-2.5 text-[13px] leading-relaxed text-ink shadow-lg"
          >
            {note}
          </div>,
          document.body,
        )}
    </div>
  );
}
