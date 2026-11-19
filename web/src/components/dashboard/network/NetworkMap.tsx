"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, MapView, WebMercatorViewport, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { ArcLayer, GeoJsonLayer, IconLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import { nextPeriod, periodsOf } from "@/lib/network-timeline";
import { boundsOf, buildNetwork, neighbourhood, throughput, type NetworkEdge, type NetworkNode, type NetworkRow } from "@/lib/network-graph";
import type { NetworkVisual } from "@/lib/templates/schema";
import { CATEGORY_PALETTE, KIND_PALETTE, colorMap, lighten, readTheme, withAlpha, type NetworkTheme, type Rgb } from "./colors";
import { iconOf, iconShape } from "./icons";
import { NetworkTimeline } from "./NetworkTimeline";
import {
  EdgeTip, NetworkLegend, NetworkSummary, NetworkTooltip, NodeDetail, NodeTip, categoryKey, kindKey, type PanelMeasure,
} from "./NetworkPanels";

export interface NetworkMapProps {
  visual: NetworkVisual;
  rows: NetworkRow[];
  measures: Record<string, PanelMeasure>;
}

type Areas = FeatureCollection<Geometry, { codarea: string }>;

/**
 * Height of the drawing of a place on the map, in metres: it grows as the reader comes closer, like a
 * building would, within the limits in pixels below (the smallest still readable, the largest a landmark).
 */
const MIN_ICON_M = 14_000;
const MAX_ICON_M = 70_000;
const MIN_ICON_PX = 16;
const MAX_ICON_PX = 140;
/** Metres per pixel at the equator, zoom 0 (Web Mercator, 512-pixel tiles as deck.gl draws them). */
const EQUATOR_M_PER_PX = 78_271.517;
/** Height of the map surface (the states are raised this much), in metres. */
const GROUND = 9_000;
/** Time each period stays on the map while the timeline plays. */
const PLAY_STEP_MS = 1_600;
/** Drawn over the arcs whatever their depth: a place is never hidden behind the lines that reach it. */
const ON_TOP = { depthCompare: "always", depthWriteEnabled: false } as const;
const PITCH_3D = 52;
const BEARING_3D = -14;
/** Places named on the map without hovering (the largest); the others show their name on hover. */
const LABELED = 10;
/** Partners named while a place is in focus: its largest ones. */
const FOCUS_LABELS = 12;
const GRAY: Rgb = [128, 128, 128];

/** Whether this browser can open a WebGL 2 context (what the 3D map is drawn with). */
function hasWebgl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

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
  // The whole time span: it fixes the colours, the legend and the frame, so they hold while periods change.
  const whole = useMemo(() => buildNetwork(visual, rows), [visual, rows]);
  const periods = useMemo(() => (visual.time ? periodsOf(rows, visual.time, visual.measure) : []), [visual.time, visual.measure, rows]);
  const [period, setPeriod] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (period !== null && !periods.some((p) => p.key === period)) setPeriod(null);
  }, [periods, period]);
  const graph = useMemo(() => {
    const time = visual.time;
    return time && period !== null ? buildNetwork(visual, rows.filter((r) => String(r[time] ?? "") === period)) : whole;
  }, [visual, rows, period, whole]);
  // Playing: one period after the other, stopping at the last.
  useEffect(() => {
    if (!playing) return;
    const step = (): void => setPeriod((current) => {
      const next = nextPeriod(periods, current);
      if (next === null) setPlaying(false);
      return next ?? current;
    });
    // From "Todos" or the last period, playing starts over at the first.
    if (period === null || period === periods[periods.length - 1]?.key) setPeriod(periods[0]?.key ?? null);
    const timer = window.setInterval(step, PLAY_STEP_MS);
    return () => window.clearInterval(timer);
    // The period changes on every step: only starting and stopping restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, periods]);
  const kindColor = useMemo(() => colorMap(whole.kinds, KIND_PALETTE), [whole.kinds]);
  const categoryColor = useMemo(() => colorMap(whole.categories, CATEGORY_PALETTE), [whole.categories]);
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
  // The browser may have no WebGL (turned off, no graphics acceleration, a crashed GPU process): the map
  // then says so instead of waiting forever.
  const [noWebgl, setNoWebgl] = useState(false);
  useEffect(() => {
    if (!hasWebgl()) setNoWebgl(true);
  }, []);

  // The first frame (and every new set of places, after a filter) frames the whole network.
  const framed = useRef<string>("");
  useEffect(() => {
    if (width === 0 || height === 0) return;
    const key = whole.nodes.map((n) => n.id).sort().join("|");
    if (framed.current === key && view) return;
    framed.current = key;
    setView(fitView(whole.nodes, width, height, flat));
    // Only a new network or the first size reframes; turning 2D/3D, resizing and the timeline keep the reader's place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whole.nodes, width > 0 && height > 0]);
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
    setView({ ...fitView(whole.nodes, width, height, toFlat), transitionDuration: 900, transitionInterpolator: new FlyToInterpolator() });
  }, [whole.nodes, width, height]);

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
  const iconSize = useCallback((n: NetworkNode) => MIN_ICON_M + (MAX_ICON_M - MIN_ICON_M) * Math.sqrt(throughput(n) / maxNode), [maxNode]);
  // The zoom in steps (a label offset is redone per step, not per frame of a pan).
  const zoomStep = Math.round((view?.zoom ?? 4) * 4) / 4;
  /** The drawing's height on screen now, in pixels (to put the name right above it). */
  const iconPixels = useCallback((n: NetworkNode) => {
    const metresPerPixel = (EQUATOR_M_PER_PX * Math.cos((n.lat * Math.PI) / 180)) / 2 ** zoomStep;
    return Math.min(MAX_ICON_PX, Math.max(MIN_ICON_PX, iconSize(n) / metresPerPixel));
  }, [iconSize, zoomStep]);
  // Farther (north) first, so the nearer drawings stand in front of them in the tilted view.
  const drawOrder = useMemo(() => [...visibleNodes].sort((a, b) => b.lat - a.lat), [visibleNodes]);
  const labeled = useMemo(() => {
    const top = [...visibleNodes].sort((a, b) => throughput(b) - throughput(a)).slice(0, LABELED);
    const ids = new Set(top.map((n) => n.id));
    // In focus, the place and its largest partners are named (a hub may relate to hundreds of places).
    if (focus) {
      ids.add(focus);
      for (const p of byId.get(focus)?.partners.slice(0, FOCUS_LABELS) ?? []) ids.add(p.id);
    }
    return visibleNodes.filter((n) => ids.has(n.id));
  }, [visibleNodes, focus, byId]);

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
        getElevation: GROUND,
        getFillColor: withAlpha(theme.dark ? lighten(theme.card, 0.04) : theme.bg, 255),
        getLineColor: withAlpha(theme.dark ? lighten(theme.line, 0.15) : theme.line, 255),
        material: { ambient: 0.55, diffuse: 0.5, shininess: 8, specularColor: [40, 40, 40] },
        pickable: false,
      }),
      new ArcLayer<NetworkEdge>({
        id: "relacoes",
        data: visibleEdges,
        getSourcePosition: (e) => { const n = byId.get(e.source); return n ? [n.lon, n.lat, GROUND] : [0, 0]; },
        getTargetPosition: (e) => { const n = byId.get(e.target); return n ? [n.lon, n.lat, GROUND] : [0, 0]; },
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
      // The shadow of each drawing on the ground: it shows where the place is and gives the scene depth.
      new ScatterplotLayer<NetworkNode>({
        id: "sombras",
        data: drawOrder,
        getPosition: (n) => [n.lon, n.lat, GROUND],
        getRadius: (n) => iconSize(n) * 0.3,
        radiusUnits: "meters",
        radiusMinPixels: MIN_ICON_PX * 0.3,
        radiusMaxPixels: MAX_ICON_PX * 0.3,
        getFillColor: (n) => [0, 0, 0, (theme.dark ? 120 : 55) * dim(!lit || lit.nodes.has(n.id))],
        parameters: ON_TOP,
        updateTriggers: { getRadius: maxNode, getFillColor: [lit, theme] },
      }),
      new IconLayer<NetworkNode>({
        id: "locais",
        data: drawOrder,
        getIcon: (n) => iconOf(iconShape(n.kind)),
        getPosition: (n) => [n.lon, n.lat, GROUND],
        getSize: iconSize,
        sizeUnits: "meters",
        sizeMinPixels: MIN_ICON_PX,
        sizeMaxPixels: MAX_ICON_PX,
        getColor: nodeColor,
        billboard: true,
        alphaCutoff: 0.05,
        parameters: ON_TOP,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 140],
        transitions: { getSize: { duration: 700 } },
        updateTriggers: { getColor: [lit, kindColor], getSize: maxNode },
      }),
      new TextLayer<NetworkNode>({
        id: "nomes",
        data: labeled,
        characterSet: "auto",
        getPosition: (n) => [n.lon, n.lat, GROUND],
        getText: (n) => n.label,
        getSize: 12,
        getColor: withAlpha(theme.text, 255),
        getPixelOffset: (n) => [0, -(iconPixels(n) + 4)],
        background: true,
        getBackgroundColor: withAlpha(theme.card, 215),
        backgroundPadding: [5, 2],
        fontFamily: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
        fontWeight: 600,
        billboard: true,
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        parameters: ON_TOP,
        updateTriggers: { getPixelOffset: [maxNode, zoomStep], getColor: theme, getBackgroundColor: theme },
      }),
    ].filter(Boolean);
  }, [theme, states, visibleEdges, labeled, byId, kindColor, categoryColor, lit, maxEdge, maxNode, iconSize, iconPixels, drawOrder, zoomStep]);

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
  const periodTitle = period !== null ? periods.find((p) => p.key === period)?.title : undefined;
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
          onError={(error) => {
            if (/webgl|context/i.test(error?.message ?? "")) setNoWebgl(true);
          }}
          // Arcs are thin: anything within a few pixels of the pointer counts as hovered.
          pickingRadius={6}
          onHover={onHover}
          onClick={onClick}
          getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        />
      )}
      {noWebgl && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <p className="max-w-md rounded-xl border border-line/70 bg-card/90 px-5 py-4 text-center text-sm shadow-xl">
            <b className="block">Este navegador não conseguiu iniciar o mapa 3D.</b>
            <span className="mt-1 block text-muted">
              O 3D usa a placa de vídeo (WebGL), que está desativada ou travou. Feche e abra o navegador de novo, ou ative a
              aceleração por hardware nas configurações dele.
            </span>
          </p>
        </div>
      )}
      {!ready && !noWebgl && graph.nodes.length > 0 && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted"><span className="animate-pulse">Montando o mapa 3D…</span></p>
      )}
      {graph.nodes.length === 0 && (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted">Sem locais com coordenadas para os filtros atuais.</p>
      )}

      {/* Top: what the map holds, the timeline, the view buttons (the timeline goes under them on narrow screens). */}
      <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex flex-wrap items-start gap-3 xl:flex-nowrap">
        <div className="w-80 max-w-full shrink-0">
          <NetworkSummary graph={graph} kindColor={kindColor} measure={main} title={periodTitle ? `${visual.title} · ${periodTitle}` : visual.title} />
        </div>
        {periods.length > 1 && (
          <div className="order-last flex min-w-0 basis-full justify-center xl:order-none xl:basis-auto xl:flex-1">
            <NetworkTimeline
              periods={periods} value={period} onChange={setPeriod} playing={playing} onPlay={setPlaying}
              format={main.format} measureLabel={main.label}
            />
          </div>
        )}
        <div className="pointer-events-auto ml-auto flex shrink-0 flex-wrap justify-end gap-2">
        <button type="button" className={BUTTON} aria-pressed={!flat} onClick={() => { setFlat(!flat); reframe(!flat); }} title="Alternar entre a vista inclinada (3D) e a de cima (2D)">
          {flat ? "Ver em 3D" : "Ver de cima"}
        </button>
        <button type="button" className={BUTTON} aria-pressed={spin} onClick={() => setSpin(!spin)}>Girar</button>
        <button type="button" className={BUTTON} onClick={() => { setSpin(false); reframe(flat); }}>Recentralizar</button>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex max-h-[calc(100%-12rem)] flex-col justify-end">
        <NetworkLegend kinds={whole.kinds} categories={whole.categories} kindColor={kindColor} categoryColor={categoryColor} hidden={hidden} onToggle={toggle} />
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
