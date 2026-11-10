"use client";

import { useEffect, useRef } from "react";
import { takeJump } from "./jump";

interface DashboardArrivalProps {
  dashboardId: string;
  /** Section anchors of this dashboard, joined by "|". */
  anchorsKey: string;
}

/**
 * Where the reader lands when a dashboard takes the screen: on the analysis picked in the sidebar, or
 * at the top when the dashboard changed. The address is the same for every dashboard of the space, so
 * the browser would otherwise keep the previous scroll position.
 */
export function DashboardArrival({ dashboardId, anchorsKey }: DashboardArrivalProps) {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const changed = previous.current !== null && previous.current !== dashboardId;
    previous.current = dashboardId;
    const anchor = takeJump(anchorsKey.split("|"));
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
    else if (changed) window.scrollTo({ top: 0 });
  }, [dashboardId, anchorsKey]);

  return null;
}
