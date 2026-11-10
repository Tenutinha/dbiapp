"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapChart as EMapChart } from "echarts/charts";
import { TooltipComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import { formatValue } from "@/lib/format";
import { categoryLegend, mix, scaleRange, strengthWeights } from "@/lib/map-colors";
import type { MapVisual, ValueFormat } from "@/lib/templates/schema";
import { isAdditive, useCrossFilter } from "./useCrossFilter";

echarts.use([EMapChart, TooltipComponent, VisualMapComponent, CanvasRenderer]);

type Row = Record<string, string | number | boolean | null>;
type Geo = MapVisual["geo"];
type Areas = FeatureCollection<Geometry, { codarea: string }>;

export interface MapMeasure {
  id: string;
  label: string;
  format: ValueFormat;
}

export interface MapChartProps {
  visual: MapVisual;
  rows: Row[];
  measures: Record<string, MapMeasure>;
}

/** IBGE meshes, fetched once per page and converted from TopoJSON. */
const meshes = new Map<Geo, Promise<Areas>>();

function loadMesh(geo: Geo): Promise<Areas> {
  let p = meshes.get(geo);
  if (!p) {
    p = fetch(`/geo/${geo}.topo.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`malha ${geo}: HTTP ${r.status}`);
        return r.json() as Promise<Topology>;
      })
      .then((topo) => {
        const name = Object.keys(topo.objects)[0];
        return feature(topo, topo.objects[name] as GeometryCollection<{ codarea: string }>) as Areas;
      });
    p.catch(() => meshes.delete(geo)); // let a later render retry
    meshes.set(geo, p);
  }
  return p;
}

/** Registers the mesh restricted to the areas with data (so a UF filter zooms in) and returns its name. */
function registerAreas(geo: Geo, mesh: Areas, codes: ReadonlySet<string>): string {
  const all = codes.size === 0 || mesh.features.every((f) => codes.has(f.properties.codarea));
  const features = all ? mesh.features : mesh.features.filter((f) => codes.has(f.properties.codarea));
  let h = 0;
  for (const f of features) for (const ch of f.properties.codarea) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const name = all ? `${geo}:all` : `${geo}:${features.length}:${h >>> 0}`;
  if (!echarts.getMap(name)) {
    echarts.registerMap(name, { type: "FeatureCollection", features } as Parameters<typeof echarts.registerMap>[1]);
  }
  return name;
}

interface Colors {
  card: string;
  line: string;
  text: string;
  muted: string;
  brand: string;
}

function readColors(el: HTMLElement): Colors {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    card: v("--color-card", "#111623"),
    line: v("--color-line", "#222a3d"),
    text: v("--color-text", "#e8ecf5"),
    muted: v("--color-muted", "#8d97ad"),
    brand: v("--color-brand", "#7c5cff"),
  };
}

const DIVERGING = ["#ea580c", "#f5f5f4", "#16a34a"];

/** Cross-filter look of an area: the picked ones get an outline, the others fade. */
function pickStyle(picked: readonly string[], areaCode: string, c: Colors): { opacity?: number; borderColor?: string; borderWidth?: number } {
  if (picked.length === 0) return {};
  return picked.includes(areaCode) ? { borderColor: c.text, borderWidth: 1.2 } : { opacity: 0.3 };
}

function buildOption(props: MapChartProps, mapName: string, c: Colors, picked: readonly string[]): echarts.EChartsCoreOption {
  const { visual, rows, measures } = props;
  const fmt = (id: string, v: unknown): string => formatValue(v, measures[id]?.format ?? "number");
  const code = (r: Row): string => String(r[visual.field] ?? "");
  const color = visual.color;
  const tipIds = [color.measure, ...visual.tooltip.filter((id) => id !== color.measure)];

  const tooltip = {
    trigger: "item",
    backgroundColor: c.card,
    borderColor: c.line,
    textStyle: { color: c.text },
    formatter: (p: { data?: { row?: Row } }) => {
      const r = p.data?.row;
      if (!r) return "";
      const title = visual.labelField ? String(r[visual.labelField] ?? code(r)) : code(r);
      const lines = tipIds.map((id) => `${escapeHtml(measures[id]?.label ?? id)}: <b>${escapeHtml(fmt(id, r[id]))}</b>`);
      return [`<b>${escapeHtml(title)}</b>`, ...lines].join("<br/>");
    },
  };
  const series = {
    type: "map",
    map: mapName,
    nameProperty: "codarea",
    roam: true,
    selectedMode: false,
    label: { show: false },
    emphasis: { label: { show: false }, itemStyle: { areaColor: c.brand } },
    itemStyle: { borderColor: c.line, borderWidth: 0.2, areaColor: c.line },
  };

  if (color.mode === "category") {
    const weights = color.strengthMeasure
      ? strengthWeights(rows.map((r) => (r[color.strengthMeasure!] === null ? null : Number(r[color.strengthMeasure!]))))
      : rows.map(() => 1);
    return {
      tooltip,
      series: [{
        ...series,
        data: rows.map((r, i) => ({
          name: code(r),
          value: 1,
          row: r,
          itemStyle: { areaColor: mix(r[color.colorMeasure], c.card, weights[i]), ...pickStyle(picked, code(r), c) },
        })),
      }],
    };
  }

  const values = rows.map((r) => Number(r[color.measure])).filter(Number.isFinite);
  const diverging = color.scheme === "diverging";
  const range = scaleRange(values, diverging);
  return {
    tooltip,
    visualMap: {
      ...range,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 160,
      textStyle: { color: c.muted },
      formatter: (v: number) => fmt(color.measure, v),
      inRange: { color: diverging ? DIVERGING : [mix(c.brand, c.card, 0.12), c.brand] },
    },
    series: [{
      ...series,
      data: rows.map((r) => ({ name: code(r), value: Number(r[color.measure]), row: r, itemStyle: pickStyle(picked, code(r), c) })),
    }],
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function MapChart(props: MapChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const [mesh, setMesh] = useState<Areas | null>(null);
  const [failed, setFailed] = useState(false);
  const { visual, rows, measures } = props;
  const { own, pick, pending } = useCrossFilter(visual.id, [visual.field]);
  const pickedKey = JSON.stringify(own[visual.field] ?? []);
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  }, [pick]);

  useEffect(() => {
    let alive = true;
    loadMesh(visual.geo).then(
      (m) => alive && setMesh(m),
      (err: unknown) => {
        console.error("[map] failed to load mesh", err);
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [visual.geo]);

  useEffect(() => {
    if (!el.current || !mesh) return;
    const codes = new Set(rows.map((r) => String(r[visual.field] ?? "")));
    const mapName = registerAreas(visual.geo, mesh, codes);
    const node = el.current;
    let chart: echarts.ECharts | null = null;
    // ECharts' geo projection breaks on a 0×0 box (hidden tab, styles not loaded yet): wait for a real size.
    const draw = (): void => {
      if (node.clientWidth === 0 || node.clientHeight === 0) return;
      if (chart) {
        chart.resize();
        return;
      }
      chart = echarts.init(node, undefined, { renderer: "canvas" });
      chart.setOption(buildOption({ visual, rows, measures }, mapName, readColors(node), JSON.parse(pickedKey) as string[]));
      // Clicking an area cross-filters the other visuals by it.
      chart.on("click", (p) => {
        const row = (p.data as { row?: Row } | undefined)?.row;
        if (!row) return;
        pickRef.current([{ fieldId: visual.field, value: String(row[visual.field] ?? "") }], isAdditive(p.event?.event as MouseEvent | undefined));
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(node);
    return () => {
      observer.disconnect();
      chart?.dispose();
    };
  }, [measures, mesh, rows, visual, pickedKey]);

  const legend = useMemo(() => {
    const c = visual.color;
    if (c.mode !== "category") return [];
    return categoryLegend(rows.map((r) => ({ label: String(r[c.measure] ?? "—"), color: String(r[c.colorMeasure] ?? "") })));
  }, [rows, visual.color]);

  if (failed) return <p className="py-6 text-sm text-danger">Não foi possível carregar o mapa.</p>;

  return (
    <div>
      {!mesh && <p className="py-2 text-sm text-muted">Carregando mapa…</p>}
      <div ref={el} className={`w-full transition-opacity md:!h-[520px] ${pending ? "opacity-60" : ""}`} style={{ height: 440 }} role="img" aria-label={visual.title} />
      {legend.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {legend.map((l) => (
            <li key={l.label} className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm" style={{ background: mix(l.color, "#000000", 1) }} />
              {l.label} <span className="tabular-nums">({l.count.toLocaleString("pt-BR")})</span>
            </li>
          ))}
          {visual.color.mode === "category" && visual.color.strengthMeasure && (
            <li>· cor mais forte = {props.measures[visual.color.strengthMeasure]?.label.toLowerCase()} maior</li>
          )}
        </ul>
      )}
    </div>
  );
}
