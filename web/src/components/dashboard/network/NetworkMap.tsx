"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, MapView, WebMercatorViewport, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { ArcLayer, ColumnLayer, GeoJsonLayer, TextLayer } from "@deck.gl/layers";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import { boundsOf, buildNetwork, neighbourhood, throughput, type NetworkEdge, type NetworkNode, type NetworkRow } from "@/lib/network-graph";
import type { NetworkVisual } from "@/lib/templates/schema";
import { CATEGORY_PALETTE, KIND_PALETTE, colorMap, lighten, readTheme, withAlpha, type NetworkTheme, type Rgb } from "./colors";
import {
  EdgeTip, NetworkLegend, NetworkSummary, NetworkTooltip, NodeDetail, NodeTip, categoryKey, kindKey, type PanelMeasure,
} from "./NetworkPanels";

export interface NetworkMapProps {
  visual: NetworkVisual;
  rows: NetworkRow[];
  measures: Record<string, PanelMeasure>;
}

type Areas = FeatureCollection<Geometry, { codarea: string }>;

/** Tallest place, in metres: tall enough to read from far, short of hiding the map ("an interesting scale"). */
const MAX_HEIGHT = 560_000;
const MIN_HEIGHT = 18_000;
const COLUMN_RADIUS = 20_000;
const PITCH_3D = 52;
const BEARING_3D = -14;
/** Places named on the map without hovering (the largest); the others show their name on hover. */
const LABELED = 10;
const GRAY: Rgb = [128, 128, 128];

let mesh: Promise<Areas> | null = null;
function loadStates(): Promise<Areas> {
  mesh ??= fetch("/geo/uf.topo.json")
    .then((r) => {
      if (!r.ok) throw new Error(`malha uf: HTTP ${r.status}`);
      return r.json() as Promise<Topology>;
    })
    .then((topo) => {
      const name = Object.keys(topo.objects)[0];
      return feature(topo, topo.objects[name] as GeometryCollection<{ codarea: string }>) as Areas;
    });
  mesh.catch(() => { mesh = null; });
  return mesh;
}

function useTheme(ref: React.RefObject<HTMLElement | null>): NetworkTheme | null {
  const [theme, setTheme] = useState<NetworkTheme | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (): void => setTheme(readTheme(el));
    read();
    // The theme toggle changes attributes up the tree (the page or the space's scope).
    const observer = new MutationObserver(read);
    for (let node: Element | null = el; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", read);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", read);
    };
  }, [ref]);
  return theme;
}

function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function fitView(nodes: readonly NetworkNode[], width: number, height: number, flat: boolean): MapViewState {
  const bounds = boundsOf(nodes) ?? [[-74, -34], [-34, 5]];
  const fitted = new WebMercatorViewport({ width: Math.max(width, 200), height: Math.max(height, 200) })
    // Room for the panels over the map: the summary above, the legend at the bottom left.
    .fitBounds(bounds, { padding: { top: 150, bottom: 60, left: Math.min(240, width * 0.25), right: 60 } });
  return {
    longitude: fitted.longitude,
    // Tilted, the south of the frame comes closer: the centre moves a little south so the whole network stays in sight.
    latitude: flat ? fitted.latitude : fitted.latitude - (bounds[1][1] - bounds[0][1]) * 0.08,
    zoom: flat ? fitted.zoom : fitted.zoom + 0.3,
    pitch: flat ? 0 : PITCH_3D,
    bearing: flat ? 0 : BEARING_3D,
  };
}

type Hover = { x: number; y: number } & ({ kind: "node"; node: NetworkNode } | { kind: "edge"; edge: NetworkEdge });

const BUTTON = "rounded-lg border border-line/70 bg-card/85 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-md transition hover:border-brand/60 hover:text-brand aria-pressed:border-brand aria-pressed:text-brand";

export default function NetworkMap({ visual, rows, measures }: NetworkMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const theme = useTheme(box);
  const { width, height } = useSize(box);
  const graph = useMemo(() => buildNetwork(visual, rows), [visual, rows]);
  const kindColor = useMemo(() => colorMap(graph.kinds, KIND_PALETTE), [graph.kinds]);
  const categoryColor = useMemo(() => colorMap(graph.categories, CATEGORY_PALETTE), [graph.categories]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const main: PanelMeasure = measures[visual.measure] ?? { id: visual.measure, label: visual.measure, format: "number" };
  const edgeMeasures = useMemo(
    () => [...new Set([visual.measure, ...visual.tooltip])].map((id) => measures[id] ?? { id, label: id, format: "number" as const }),
    [visual.measure, visual.tooltip, measures],
  );

  const [states, setStates] = useState<Areas | null>(null);
  useEffect(() => {
    let live = true;
    loadStates().then((m) => live && setStates(m)).catch(() => live && setStates(null));
    return () => { live = false; };
  }, []);

  const [flat, setFlat] = useState(false);
  const [spin, setSpin] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [view, setView] = useState<MapViewState | null>(null);
  // WebGL takes a moment to start: until the first frame, the reader is told the map is on its way.
  const [ready, setReady] = useState(false);

  // The first frame (and every new set of places, after a filter) frames the whole network.
  const framed = useRef<string>("");
  useEffect(() => {
    if (width === 0 || height === 0) return;
    const key = graph.nodes.map((n) => n.id).sort().join("|");
    if (framed.current === key && view) return;
    framed.current = key;
    setView(fitView(graph.nodes, width, height, flat));
    // Only a new network or the first size reframes; turning 2D/3D and resizing keep the reader's place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes, width > 0 && height > 0]);
  useEffect(() => {
    if (picked && !byId.has(picked)) setPicked(null);
  }, [byId, picked]);

  // A slow turn around the network while "Girar" is on (stopped by any drag).
  useEffect(() => {
    if (!spin) return;
    let frame = 0;
    const turn = (): void => {
      setView((v) => (v ? { ...v, bearing: (v.bearing ?? 0) + 0.08 } : v));
      frame = requestAnimationFrame(turn);
    };
    frame = requestAnimationFrame(turn);
    return () => cancelAnimationFrame(frame);
  }, [spin]);

  const reframe = useCallback((toFlat: boolean) => {
    setView({ ...fitView(graph.nodes, width, height, toFlat), transitionDuration: 900, transitionInterpolator: new FlyToInterpolator() });
  }, [graph.nodes, width, height]);

  // A place picked (on the map or in the list of partners) comes to the middle of the free part of the map.
  useEffect(() => {
    const node = picked ? byId.get(picked) : undefined;
    if (!node) return;
    setSpin(false);
    setView((v) => v && {
      ...v,
      longitude: node.lon,
      latitude: node.lat - (v.pitch ? 0.5 : 0),
      zoom: Math.max(v.zoom, 5),
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator(),
    });
  }, [picked, byId]);

  const focus = hover?.kind === "node" ? hover.node.id : picked;
  const lit = useMemo(() => (focus ? neighbourhood(graph, focus) : null), [graph, focus]);

  const visibleNodes = useMemo(() => graph.nodes.filter((n) => !hidden.has(kindKey(n.kind))), [graph.nodes, hidden]);
  const shown = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => graph.edges.filter((e) => shown.has(e.source) && shown.has(e.target) && !(e.category && hidden.has(categoryKey(e.category)))),
    [graph.edges, shown, hidden],
  );
  const maxNode = useMemo(() => Math.max(1, ...graph.nodes.map(throughput)), [graph.nodes]);
  const maxEdge = useMemo(() => Math.max(1, ...graph.edges.map((e) => e.value)), [graph.edges]);
  const elevation = useCallback((n: NetworkNode) => MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * Math.sqrt(throughput(n) / maxNode), [maxNode]);
  const labeled = useMemo(() => {
    const top = [...visibleNodes].sort((a, b) => throughput(b) - throughput(a)).slice(0, LABELED);
    const ids = new Set(top.map((n) => n.id));
    if (lit) for (const id of lit.nodes) ids.add(id);
    return visibleNodes.filter((n) => ids.has(n.id));
  }, [visibleNodes, lit]);

  const layers = useMemo(() => {
    if (!theme) return [];
    const dim = (inFocus: boolean): number => (lit && !inFocus ? 0.18 : 1);
    const nodeColor = (n: NetworkNode) => withAlpha(kindColor.get(n.kind) ?? GRAY, 235 * dim(!lit || lit.nodes.has(n.id)));
    const edgeAlpha = (e: NetworkEdge): number => (lit ? (lit.edges.has(e.key) ? 240 : 22) : 170);
    const catColor = (e: NetworkEdge): Rgb => (e.category ? categoryColor.get(e.category) ?? GRAY : KIND_PALETTE[1]);
    return [
      states && new GeoJsonLayer({
        id: "estados",
        data: states,
        filled: true,
        extruded: true,
        wireframe: true,
        getElevation: 9_000,
        getFillColor: withAlpha(theme.dark ? lighten(theme.card, 0.04) : theme.bg, 255),
        getLineColor: withAlpha(theme.dark ? lighten(theme.line, 0.15) : theme.line, 255),
        material: { ambient: 0.55, diffuse: 0.5, shininess: 8, specularColor: [40, 40, 40] },
        pickable: false,
      }),
      new ArcLayer<NetworkEdge>({
        id: "relacoes",
        data: visibleEdges,
        getSourcePosition: (e) => { const n = byId.get(e.source); return n ? [n.lon, n.lat, 9_000] : [0, 0]; },
        getTargetPosition: (e) => { const n = byId.get(e.target); return n ? [n.lon, n.lat, 9_000] : [0, 0]; },
        getSourceColor: (e) => withAlpha(catColor(e), edgeAlpha(e)),
        getTargetColor: (e) => withAlpha(lighten(catColor(e), 0.45), edgeAlpha(e)),
        getWidth: (e) => 1 + 7 * Math.sqrt(e.value / maxEdge),
        getHeight: 0.55,
        widthUnits: "pixels",
        widthMinPixels: 1,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 220],
        updateTriggers: { getSourceColor: [lit, categoryColor], getTargetColor: [lit, categoryColor], getWidth: maxEdge },
      }),
      new ColumnLayer<NetworkNode>({
        id: "locais",
        data: visibleNodes,
        diskResolution: 28,
        radius: COLUMN_RADIUS,
        extruded: true,
        getPosition: (n) => [n.lon, n.lat, 9_000],
        getElevation: elevation,
        getFillColor: nodeColor,
        material: { ambient: 0.6, diffuse: 0.6, shininess: 32 },
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 120],
        transitions: { getElevation: { duration: 900 } },
        updateTriggers: { getFillColor: [lit, kindColor], getElevation: maxNode },
      }),
      new TextLayer<NetworkNode>({
        id: "nomes",
        data: labeled,
        characterSet: "auto",
        getPosition: (n) => [n.lon, n.lat, 9_000 + elevation(n) + 12_000],
        getText: (n) => n.label,
        getSize: 12,
        getColor: withAlpha(theme.text, 255),
        getPixelOffset: [0, -6],
        background: true,
        getBackgroundColor: withAlpha(theme.card, 215),
        backgroundPadding: [5, 2],
        fontFamily: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
        fontWeight: 600,
        billboard: true,
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        updateTriggers: { getPosition: maxNode, getColor: theme, getBackgroundColor: theme },
      }),
    ].filter(Boolean);
  }, [theme, states, visibleEdges, visibleNodes, labeled, byId, kindColor, categoryColor, lit, maxEdge, maxNode, elevation]);

  const onHover = useCallback((info: PickingInfo) => {
    if (!info.object) return setHover(null);
    if (info.layer?.id === "locais") return setHover({ kind: "node", node: info.object as NetworkNode, x: info.x, y: info.y });
    if (info.layer?.id === "relacoes") return setHover({ kind: "edge", edge: info.object as NetworkEdge, x: info.x, y: info.y });
    setHover(null);
  }, []);
  const onClick = useCallback((info: PickingInfo) => {
    if (info.layer?.id === "locais" && info.object) setPicked((p) => ((info.object as NetworkNode).id === p ? null : (info.object as NetworkNode).id));
    else if (!info.object) setPicked(null);
  }, []);
  const toggle = useCallback((key: string) => {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const pickedNode = picked ? byId.get(picked) : undefined;
  const bg = theme?.bg ?? [7, 9, 15];
  return (
    <div ref={box} className="relative size-full overflow-hidden" style={{ background: `radial-gradient(ellipse at 50% 30%, rgb(${lighten(bg, theme?.dark ? 0.06 : 0).join(",")}), rgb(${bg.join(",")}) 70%)` }}>
      {view && theme && (
        <DeckGL
          views={new MapView({ repeat: false })}
          viewState={view}
          onViewStateChange={({ viewState, interactionState }) => {
            if (interactionState?.isDragging) setSpin(false);
            setView(viewState as MapViewState);
          }}
          controller={{ dragRotate: true, touchRotate: true, keyboard: true, inertia: 300 }}
          layers={layers}
          onLoad={() => setReady(true)}
          // Arcs are thin: anything within a few pixels of the pointer counts as hovered.
          pickingRadius={6}
          onHover={onHover}
          onClick={onClick}
          getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        />
      )}
      {!ready && graph.nodes.length > 0 && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted"><span className="animate-pulse">Montando o mapa 3D…</span></p>
      )}
      {graph.nodes.length === 0 && (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted">Sem locais com coordenadas para os filtros atuais.</p>
      )}

      <div className="pointer-events-none absolute left-4 top-4 z-10"><NetworkSummary graph={graph} kindColor={kindColor} measure={main} title={visual.title} /></div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex max-h-[calc(100%-12rem)] flex-col justify-end">
        <NetworkLegend kinds={graph.kinds} categories={graph.categories} kindColor={kindColor} categoryColor={categoryColor} hidden={hidden} onToggle={toggle} />
      </div>
      <div className="absolute right-4 top-4 z-10 flex flex-wrap justify-end gap-2">
        <button type="button" className={BUTTON} aria-pressed={!flat} onClick={() => { setFlat(!flat); reframe(!flat); }} title="Alternar entre a vista inclinada (3D) e a de cima (2D)">
          {flat ? "Ver em 3D" : "Ver de cima"}
        </button>
        <button type="button" className={BUTTON} aria-pressed={spin} onClick={() => setSpin(!spin)}>Girar</button>
        <button type="button" className={BUTTON} onClick={() => { setSpin(false); reframe(flat); }}>Recentralizar</button>
      </div>
      {pickedNode && (
        <div className="pointer-events-none absolute bottom-4 right-4 top-16 z-10 flex justify-end">
          <NodeDetail
            node={pickedNode} graph={graph} measure={main} color={kindColor.get(pickedNode.kind) ?? GRAY}
            onPick={(id) => setPicked(id)} onClose={() => setPicked(null)}
          />
        </div>
      )}
      <p className={`pointer-events-none absolute bottom-3 right-4 z-10 hidden max-w-56 text-right text-[11px] leading-snug text-muted xl:block ${pickedNode ? "xl:hidden" : ""}`}>
        Arraste para mover · role para aproximar · botão direito (ou Ctrl) + arraste para girar e inclinar
      </p>

      {hover && (
        <NetworkTooltip x={hover.x} y={hover.y} width={width} height={height}>
          {hover.kind === "node"
            ? <NodeTip node={hover.node} measure={main} color={kindColor.get(hover.node.kind) ?? GRAY} />
            : (
              <EdgeTip
                edge={hover.edge} from={byId.get(hover.edge.source)} to={byId.get(hover.edge.target)} measures={edgeMeasures}
                color={hover.edge.category ? categoryColor.get(hover.edge.category) ?? GRAY : GRAY}
              />
            )}
        </NetworkTooltip>
      )}
    </div>
  );
}
