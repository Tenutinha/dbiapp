"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface AutoRefreshProps {
  /** When the server rendered the panel: each new rendering starts the wait again. */
  renderedAt: number;
  afterMs?: number;
}

/**
 * While something runs (a load by the script, a build), asks the server for the panel again a few seconds
 * after it arrived. Counting from each arrival, never on a fixed beat: the panel can take longer than the
 * wait to come (listing thousands of files), and a fixed beat would pile requests up.
 */
export function AutoRefresh({ renderedAt, afterMs = 20_000 }: AutoRefreshProps) {
  const router = useRouter();
  useEffect(() => {
    let timer = 0;
    const schedule = (): void => {
      timer = window.setTimeout(() => {
        // Not while the tab is hidden: nobody is looking, and the bucket listings cost. Try again later.
        if (document.visibilityState === "visible") router.refresh();
        else schedule();
      }, afterMs);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [router, afterMs, renderedAt]);
  return null;
}
