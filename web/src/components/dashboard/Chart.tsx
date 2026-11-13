"use client";

import { useEffect, useRef } from "react";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { formatValue } from "@/lib/format";
import type { ValueFormat } from "@/lib/templates/schema";
import { isAdditive, useCrossFilter } from "./useCrossFilter";

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

/** Extra series colours after the space's two brand colours. */
const EXTRA_SERIES = ["#f5b83d", "#34d399", "#f472b6", "#60a5fa", "#a3e635", "#fb923c"];

/** Colours read from the themed CSS variables around the chart (see lib/theme). */
interface ChartColors {
  palette: string[];
  card: string;
  line: string;
  text: string;
  muted: string;
  grid: string;
  axis: string;
}

function readColors(el: HTMLElement): ChartColors {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    palette: [v("--color-brand", "#7c5cff"), v("--color-brand-2", "#22d3ee"), ...EXTRA_SERIES],
    card: v("--color-card", "#111623"),
    line: v("--color-line", "#222a3d"),
    text: v("--color-text", "#e8ecf5"),
    muted: v("--color-muted", "#8d97ad"),
    grid: v("--chart-grid", "#1b2233"),
    axis: v("--chart-axis", "#2c3550"),
  };
}

export interface ChartMeasure {
  id: string;
  label: string;
  format: ValueFormat;
}

export interface ChartProps {
  /** Id of the visual in the template: names its cross-filter selection. */
  visualId: string;
  type: "bar" | "line" | "donut";
  fieldId: string;
  measures: ChartMeasure[];
  rows: Record<string, string | number | boolean | null>[];
  horizontal?: boolean;
  /** Each value written next to its bar or point. */
  labels?: boolean;
}

/** Opacity of the items left out of the selection. */
const DIMMED = 0.28;

function buildOption(
  { type, fieldId, measures, rows, horizontal, labels }: ChartProps, c: ChartColors, picked: readonly string[],
): echarts.EChartsCoreOption {
  const categories = rows.map((r) => String(r[fieldId] ?? ""));
  const opacity = (category: string): number => (picked.length === 0 || picked.includes(category) ? 1 : DIMMED);
  const PALETTE = c.palette;
  const AXIS = { axisLine: { lineStyle: { color: c.axis } }, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.grid } } };
  const tooltip = {
    backgroundColor: c.card,
    borderColor: c.line,
    textStyle: { color: c.text },
  };

  if (type === "donut") {
    const m = measures[0];
    return {
      color: PALETTE,
      tooltip: { ...tooltip, trigger: "item", valueFormatter: (v: unknown) => formatValue(v, m.format) },
      legend: { bottom: 0, textStyle: { color: c.muted }, type: "scroll" },
      series: [{
        type: "pie", radius: ["48%", "72%"], center: ["50%", "44%"], avoidLabelOverlap: true,
        itemStyle: { borderColor: c.card, borderWidth: 2 }, label: { show: false },
        data: rows.map((r, i) => ({
          name: categories[i], value: Number(r[m.id] ?? 0), itemStyle: { opacity: opacity(categories[i]) },
        })),
      }],
    };
  }

  const fmt = measures[0].format;
  // Bars with their values written next to them need no value axis: it would only repeat the numbers.
  const bareValues = labels === true && type === "bar";
  const valueAxis = {
    type: "value", ...AXIS,
    axisLabel: { ...AXIS.axisLabel, show: !bareValues, formatter: (v: number) => formatValue(v, fmt, true) },
    splitLine: { ...AXIS.splitLine, show: !bareValues },
  };
  const categoryAxis = {
    type: "category", data: categories, ...AXIS,
    // Long names (a provider, a status) are cut so the bars keep their room.
    axisLabel: { ...AXIS.axisLabel, hideOverlap: true, ...(horizontal ? { width: 170, overflow: "truncate" } : {}) },
  };
  return {
    color: PALETTE,
    tooltip: { ...tooltip, trigger: "axis", valueFormatter: (v: unknown) => formatValue(v, fmt) },
    legend: measures.length > 1 ? { top: 0, textStyle: { color: c.muted } } : undefined,
    // Room on the far side of the bars for the values written beyond them.
    grid: { left: 8, right: labels && horizontal ? 56 : 16, top: (measures.length > 1 ? 32 : 12) + (labels && !horizontal ? 8 : 0), bottom: 8, containLabel: true },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series: measures.map((m, i) => ({
      name: m.label,
      type,
      label: labels
        ? {
            show: true, position: horizontal ? "right" : "top", color: c.text, fontSize: 11, fontWeight: 600,
            formatter: (p: { value: unknown }) => formatValue(p.value, m.format, true),
          }
        : undefined,
      smooth: type === "line",
      showSymbol: false,
      areaStyle: type === "line" ? { opacity: 0.08 } : undefined,
      barMaxWidth: 28,
      itemStyle: type === "bar" ? { borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } : undefined,
      data: type === "bar"
        ? rows.map((r, i) => ({ value: Number(r[m.id] ?? 0), itemStyle: { opacity: opacity(categories[i]) } }))
        : rows.map((r) => Number(r[m.id] ?? 0)),
      // A line has no item to dim: the picked points are marked on the axis instead.
      markLine: type === "line" && i === 0 && picked.length > 0
        ? {
            symbol: "none", silent: true, animation: false, label: { show: false },
            lineStyle: { color: c.text, type: "dashed", opacity: 0.6 },
            data: picked.filter((p) => categories.includes(p)).map((p) => (horizontal ? { yAxis: p } : { xAxis: p })),
          }
        : undefined,
    })),
  };
}

interface ZrClick {
  offsetX: number;
  offsetY: number;
  event?: MouseEvent;
}

export function Chart(props: ChartProps) {
  const { visualId, type, fieldId, measures, rows, horizontal, labels } = props;
  const el = useRef<HTMLDivElement>(null);
  const { own, pick, pending } = useCrossFilter(visualId, [fieldId]);
  const pickedKey = JSON.stringify(own[fieldId] ?? []);
  // The chart is only rebuilt when its data or selection changes; clicks always reach the latest `pick`.
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  }, [pick]);

  useEffect(() => {
    if (!el.current) return;
    const picked = JSON.parse(pickedKey) as string[];
    const chart = echarts.init(el.current, undefined, { renderer: "canvas" });
    chart.setOption(buildOption({ visualId, type, fieldId, measures, rows, horizontal, labels }, readColors(el.current), picked));

    const choose = (value: string | undefined, e: MouseEvent | undefined): void => {
      if (value !== undefined) pickRef.current([{ fieldId, value }], isAdditive(e));
    };
    if (type === "donut") {
      chart.on("click", (p) => choose(typeof p.name === "string" ? p.name : undefined, p.event?.event as MouseEvent | undefined));
    } else {
      // Anywhere in the band of a category counts, not only the bar or the line itself.
      chart.getZr().on("click", (e: ZrClick) => {
        const point = [e.offsetX, e.offsetY];
        if (!chart.containPixel({ gridIndex: 0 }, point)) return;
        const at = chart.convertFromPixel({ gridIndex: 0 }, point);
        const index = Math.round(Number(horizontal ? at[1] : at[0]));
        const row = rows[index];
        choose(row ? String(row[fieldId] ?? "") : undefined, e.event);
      });
    }

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [visualId, type, fieldId, measures, rows, horizontal, labels, pickedKey]);

  return (
    <div
      ref={el}
      className={`h-72 w-full cursor-pointer transition-opacity ${pending ? "opacity-60" : ""}`}
      role="img"
      aria-label="Gráfico: clique em um item para filtrar os outros visuais"
    />
  );
}
