"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While something runs (a load by the script, a build), asks the server for the panel again every few seconds. */
export function AutoRefresh({ everyMs = 20_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      // Not while the tab is hidden: nobody is looking, and the bucket listings cost.
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [router, everyMs]);
  return null;
}
