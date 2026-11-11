"use client";

import { useEffect, useRef } from "react";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { formatMoney } from "@/lib/controle/money";
import type { RunningPoint, SeriesPoint } from "@/lib/controle/series";

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const SALES = "Vendas";
const EXPENSES = "Despesas";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

interface Colors {
  sales: string;
  expenses: string;
  card: string;
  line: string;
  text: string;
  muted: string;
}

/** Colours come from the themed CSS variables around the chart, so it follows the space's theme. */
function readColors(el: HTMLElement): Colors {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    sales: v("--color-ok", "#34d399"),
    expenses: v("--color-danger", "#f87171"),
    card: v("--color-card", "#111623"),
    line: v("--color-line", "#222a3d"),
    text: v("--color-text", "#e8ecf5"),
    muted: v("--color-muted", "#8d97ad"),
  };
}

const reais = (cents: unknown): string => (typeof cents === "number" ? formatMoney(cents) : "—");

/** "R$ 1,2 mil" on the axis: the full amount is in the tooltip and in the cards above. */
function compact(cents: number): string {
  const value = cents / 100;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function base(c: Colors, categories: string[]): echarts.EChartsCoreOption {
  const axis = { axisLine: { lineStyle: { color: c.line } }, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.line, opacity: 0.5 } } };
  return {
    color: [c.sales, c.expenses],
    tooltip: {
      trigger: "axis", confine: true, backgroundColor: c.card, borderColor: c.line, textStyle: { color: c.text },
      valueFormatter: reais,
    },
    legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: c.muted } },
    grid: { left: 4, right: 8, top: 32, bottom: 4, containLabel: true },
    xAxis: { type: "category", data: categories, ...axis, axisTick: { show: false }, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: compact } },
  };
}

function useChart(build: (c: Colors) => echarts.EChartsCoreOption, deps: readonly unknown[]): React.RefObject<HTMLDivElement | null> {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current, undefined, { renderer: "canvas" });
    chart.setOption(build(readColors(el.current)));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the data changes
  }, deps);
  return el;
}

interface EvolutionChartsProps {
  /** Running totals of the month on screen, day by day (empty after today). */
  month: RunningPoint[];
  /** Totals of each month of the period (only its days), oldest first. */
  months: SeriesPoint[];
  /** "no mês" or "no período" (several months, last days). */
  scope?: string;
}

/** How the month is going (accumulated, day by day) and how the last months compare. */
export function EvolutionCharts({ month, months, scope = "no mês" }: EvolutionChartsProps) {
  // Within one month the axis shows the day ("11"); across months, day and month ("11/10").
  const acrossMonths = new Set(month.map((p) => p.period.slice(0, 7))).size > 1;
  const daily = useChart((c) => ({
    ...base(c, month.map((p) => (acrossMonths ? `${p.period.slice(8, 10)}/${p.period.slice(5, 7)}` : String(Number(p.period.slice(8, 10)))))),
    series: [
      { name: SALES, type: "line", smooth: true, smoothMonotone: "x", showSymbol: false, areaStyle: { opacity: 0.1 }, data: month.map((p) => p.salesCents) },
      { name: EXPENSES, type: "line", smooth: true, smoothMonotone: "x", showSymbol: false, areaStyle: { opacity: 0.06 }, data: month.map((p) => p.purchasesCents) },
    ],
  }), [month, acrossMonths]);

  const monthly = useChart((c) => ({
    ...base(c, months.map((p) => MONTHS[Number(p.period.slice(5, 7)) - 1])),
    series: [
      { name: SALES, type: "bar", barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: months.map((p) => p.salesCents) },
      { name: EXPENSES, type: "bar", barMaxWidth: 18, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: months.map((p) => p.purchasesCents) },
    ],
  }), [months]);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Evolução {scope}</h2>
        <p className="text-xs text-muted">Acumulado, dia a dia</p>
        <div ref={daily} className="mt-2 h-52 w-full" role="img" aria-label={`Gráfico de linhas: vendas e despesas acumuladas ${scope}, dia a dia`} />
      </section>
      <section className="card p-4">
        <h2 className="text-sm font-semibold">{months.length === 1 ? "Total do mês" : "Por mês"}</h2>
        <p className="text-xs text-muted">{months.length === 1 ? "Vendas e despesas" : `Total de cada mês ${scope}`}</p>
        <div ref={monthly} className="mt-2 h-52 w-full" role="img" aria-label={`Gráfico de barras: vendas e despesas de cada mês ${scope}`} />
      </section>
    </div>
  );
}
