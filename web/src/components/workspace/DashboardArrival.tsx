"use client";

import { useEffect, useRef } from "react";
import { takeJump, takeLandAtEnd } from "./jump";

/**
 * When another dashboard takes the screen the reader starts at its top. The address is the same for
 * every dashboard of the space, so the browser would otherwise keep the previous scroll position.
 * (The dashboard opens as a skeleton first; where to land in it is settled by DashboardLanding.)
 */
export function DashboardArrival({ dashboardId }: { dashboardId: string }) {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const changed = previous.current !== null && previous.current !== dashboardId;
    previous.current = dashboardId;
    if (changed) window.scrollTo({ top: 0 });
  }, [dashboardId]);

  return null;
}

/**
 * Where the reader lands once the dashboard's data is on screen: on the analysis picked in the sidebar,
 * or at the end of the page when they came back from the following dashboard. Rendered with the data,
 * because both places only exist when the page has its real height.
 */
export function DashboardLanding({ anchorsKey }: { /** Section anchors, joined by "|". */ anchorsKey: string }) {
  useEffect(() => {
    const anchor = takeJump(anchorsKey.split("|"));
    const atEnd = takeLandAtEnd();
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
    else if (atEnd) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [anchorsKey]);

  return null;
}
