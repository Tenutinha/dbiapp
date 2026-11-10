"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { SummaryItem } from "@/lib/templates/sections";
import { rememberJump } from "./jump";
import { openDashboardAction } from "./view-actions";

interface DashboardOutlineProps {
  dashboardId: string;
  dashboardName: string;
  /** The dashboard on screen: its analyses are links to the page sections and follow the scroll. */
  current: boolean;
  items: SummaryItem[];
  /** Public link (no account): the other dashboards open by this address instead of the signed-in action. */
  href?: string;
}

/** Section whose top already passed this line (px from the viewport top) counts as the current one. */
const CURRENT_LINE = 140;

/** The analysis on screen: the last section whose top has scrolled above the current line. */
function currentAnchor(anchors: readonly string[]): string | null {
  let current: string | null = null;
  for (const anchor of anchors) {
    const el = document.getElementById(anchor);
    if (el && el.getBoundingClientRect().top <= CURRENT_LINE) current = anchor;
  }
  return current;
}

/** Follows the page scroll while this is the open dashboard; null otherwise. */
function useActiveAnchor(key: string, enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const list = key.split("|");
    let frame = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(currentAnchor(list)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [key, enabled]);
  return enabled ? active : null;
}

const ROW = "flex w-full items-baseline justify-between gap-3 py-[3px] pl-7 pr-1 text-left text-[13px] leading-snug transition-colors";
const tone = (on: boolean): string => (on ? "font-medium text-ink" : "text-ink-muted hover:text-ink");

function Label({ item }: { item: SummaryItem }) {
  return (
    <>
      <span>{item.title}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-muted/70">{item.number}</span>
    </>
  );
}

function JumpButton({ item }: { item: SummaryItem }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" aria-busy={pending || undefined} className={`${ROW} ${tone(pending)} ${pending ? "animate-pulse" : ""}`}>
      <Label item={item} />
    </button>
  );
}

/**
 * The analyses of one dashboard, nested under its name in the sidebar. For the open dashboard they
 * jump to the page sections; for the others they open that dashboard already on the chosen section
 * (DashboardArrival does the landing).
 */
export function DashboardOutline({ dashboardId, dashboardName, current, items, href }: DashboardOutlineProps) {
  const active = useActiveAnchor(items.map((i) => i.anchor).join("|"), current);
  if (items.length === 0) return null;

  return (
    <ul aria-label={`Análises de ${dashboardName}`} className="pb-2 pt-0.5">
      {items.map((item) => (
        <li key={item.id}>
          {current ? (
            <a href={`#${item.anchor}`} aria-current={item.anchor === active ? "location" : undefined} className={`${ROW} ${tone(item.anchor === active)}`}>
              <Label item={item} />
            </a>
          ) : href ? (
            <Link href={href} onClick={() => rememberJump(item.anchor)} className={`${ROW} ${tone(false)}`}>
              <Label item={item} />
            </Link>
          ) : (
            <form action={openDashboardAction} onSubmit={() => rememberJump(item.anchor)}>
              <input type="hidden" name="id" value={dashboardId} />
              <JumpButton item={item} />
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
