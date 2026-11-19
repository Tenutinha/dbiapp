"use client";

import { useEffect, useRef } from "react";
import { CustomChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { formatValue } from "@/lib/format";
import type { ValueFormat } from "@/lib/templates/schema";
import { shareOfFirst, waterfallBars, type WaterfallItem } from "./waterfall-steps";

echarts.use([CustomChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface WaterfallProps {
  items: readonly WaterfallItem[];
  row: Readonly<Record<string, unknown>> | undefined;
  format: ValueFormat;
}

const percent = (share: number | null): string =>
  share === null ? "" : `${(share * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da receita`;

/**
 * From one number to another, step by step: each total stands on zero (in a neutral tone), each step
 * hangs from where the one before ended — green when it adds, red when it takes away — with its value written
 * on it. The way to read where the revenue goes on its way to the result.
 */
export function Waterfall({ items, row, format }: WaterfallProps) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    const css = getComputedStyle(box);
    const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
    // Totals in the text colour (neutral, whatever the space's brand is): green and red are kept for what adds and takes away.
    const text = v("--color-text", "#e8ecf5");
    const color = { total: text, up: v("--color-ok", "#34d399"), down: v("--color-danger", "#f87171") };
    const muted = v("--color-muted", "#8d97ad");
    const grid = v("--chart-grid", "#1b2233");
    const bars = waterfallBars(items, row);
    const short = (n: number): string => formatValue(n, format, true);

    const chart = echarts.init(box, undefined, { renderer: "canvas" });
    chart.setOption({
      animationDuration: 500,
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: { dataIndex: number }) => {
          const b = bars[p.dataIndex];
          const share = b.kind === "total" ? "" : percent(shareOfFirst(bars, b));
          return `<strong>${b.label}</strong><br/>${formatValue(b.value, format)}${share ? `<br/><span style="opacity:.7">${share}</span>` : ""}`;
        },
      },
      xAxis: {
        type: "category",
        data: bars.map((b) => b.label),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: grid } },
        axisLabel: { color: muted, interval: 0, fontSize: 11, width: 92, overflow: "break", lineHeight: 13 },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: grid } },
        axisLabel: { color: muted, fontSize: 11, formatter: (n: number) => short(n) },
      },
      series: [{
        type: "custom",
        encode: { x: 0, y: [1, 2] },
        data: bars.map((b, i) => [i, b.start, b.end]),
        renderItem: (_: unknown, api: { value: (i: number) => number; coord: (p: number[]) => number[]; size: (p: number[]) => number[] }) => {
          const i = api.value(0);
          const b = bars[i];
          const top = api.coord([i, Math.max(b.start, b.end)]);
          const bottom = api.coord([i, Math.min(b.start, b.end)]);
          const width = api.size([1, 0])[0] * 0.62;
          const fill = color[b.kind];
          const below = b.kind === "down";
          return {
            type: "group",
            children: [
              {
                type: "rect",
                shape: { x: top[0] - width / 2, y: top[1], width, height: Math.max(1, bottom[1] - top[1]), r: 3 },
                style: { fill, opacity: b.kind === "total" ? 0.78 : 0.85 },
              },
              {
                type: "text",
                style: {
                  text: `${b.kind === "up" ? "+" : ""}${short(b.value)}`,
                  x: top[0],
                  y: below ? bottom[1] + 4 : top[1] - 4,
                  align: "center",
                  verticalAlign: below ? "top" : "bottom",
                  fill: b.kind === "total" ? text : fill,
                  font: `${b.kind === "total" ? 600 : 500} 11px system-ui, sans-serif`,
                },
              },
            ],
          };
        },
      }],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(box);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [items, row, format]);

  return <div ref={el} className="h-80 w-full" role="img" aria-label="Cascata: da receita ao resultado, passo a passo" />;
}
