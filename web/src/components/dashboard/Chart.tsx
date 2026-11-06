"use client";

import { useEffect, useRef } from "react";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { formatValue } from "@/lib/format";
import type { ValueFormat } from "@/lib/templates/schema";

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

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
  type: "bar" | "line" | "donut";
  fieldId: string;
  measures: ChartMeasure[];
  rows: Record<string, string | number | boolean | null>[];
  horizontal?: boolean;
}

function buildOption({ type, fieldId, measures, rows, horizontal }: ChartProps, c: ChartColors): echarts.EChartsCoreOption {
  const categories = rows.map((r) => String(r[fieldId] ?? ""));
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
        data: rows.map((r) => ({ name: String(r[fieldId] ?? ""), value: Number(r[m.id] ?? 0) })),
      }],
    };
  }

  const fmt = measures[0].format;
  const valueAxis = { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => formatValue(v, fmt, true) } };
  const categoryAxis = { type: "category", data: categories, ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } };
  return {
    color: PALETTE,
    tooltip: { ...tooltip, trigger: "axis", valueFormatter: (v: unknown) => formatValue(v, fmt) },
    legend: measures.length > 1 ? { top: 0, textStyle: { color: c.muted } } : undefined,
    grid: { left: 8, right: 16, top: measures.length > 1 ? 32 : 12, bottom: 8, containLabel: true },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series: measures.map((m) => ({
      name: m.label,
      type,
      smooth: type === "line",
      showSymbol: false,
      areaStyle: type === "line" ? { opacity: 0.08 } : undefined,
      barMaxWidth: 28,
      itemStyle: type === "bar" ? { borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } : undefined,
      data: rows.map((r) => Number(r[m.id] ?? 0)),
    })),
  };
}

export function Chart(props: ChartProps) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current, undefined, { renderer: "canvas" });
    chart.setOption(buildOption(props, readColors(el.current)));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [props]);

  return <div ref={el} className="h-72 w-full" role="img" aria-label="Gráfico" />;
}
