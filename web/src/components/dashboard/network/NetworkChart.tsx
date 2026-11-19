"use client";

import dynamic from "next/dynamic";
import type { NetworkMapProps } from "./NetworkMap";

/** The 3D map runs on WebGL: it is loaded in the browser only, with its own bundle. */
const NetworkMap = dynamic(() => import("./NetworkMap"), {
  ssr: false,
  loading: () => (
    <div className="grid size-full place-items-center text-sm text-muted">
      <span className="animate-pulse">Montando o mapa 3D…</span>
    </div>
  ),
});

export function NetworkChart(props: NetworkMapProps) {
  return <NetworkMap {...props} />;
}
