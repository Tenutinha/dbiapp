import { formatValue } from "@/lib/format";
import type { DashboardData, VisualResult } from "@/lib/query/run";
import type { Template } from "@/lib/templates/schema";
import { buildSections } from "@/lib/templates/sections";
import { Chart, type ChartMeasure } from "./Chart";
import { FilterBar } from "./FilterBar";
import { MapChart, type MapMeasure } from "./MapChart";

const SPAN: Record<number, string> = {
  1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4",
  5: "md:col-span-5", 6: "md:col-span-6", 7: "md:col-span-7", 8: "md:col-span-8",
  9: "md:col-span-9", 10: "md:col-span-10", 11: "md:col-span-11", 12: "md:col-span-12",
};

interface DashboardViewProps {
  template: Template;
  data: DashboardData;
  totalRows: number;
}

function VisualBody({ template, result }: { template: Template; result: VisualResult }) {
  const { visual, rows } = result;
  const measure = (id: string): ChartMeasure => {
    const m = template.measures.find((x) => x.id === id);
    return { id, label: m?.label ?? id, format: m?.format ?? "number" };
  };
  const fieldLabel = (id: string): string => template.fields.find((f) => f.id === id)?.label ?? id;

  if (result.error) return <p className="py-6 text-sm text-danger">{result.error}</p>;
  if (visual.type === "text") {
    return (
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-text/90">
        {visual.body.split(/\n\s*\n/).map((p, i) => <p key={i}>{p.trim()}</p>)}
      </div>
    );
  }
  if (visual.type !== "kpi" && rows.length === 0) return <p className="py-6 text-sm text-muted">Sem dados para os filtros atuais.</p>;

  switch (visual.type) {
    case "kpi": {
      const m = measure(visual.measure);
      const value = rows[0]?.[m.id];
      // Millions and up use the short form ("R$ 2,87 bi") so the card never overflows.
      const compact = Math.abs(Number(value ?? 0)) >= 1_000_000;
      return (
        <p className="mt-1 truncate text-3xl font-extrabold tracking-tight" title={formatValue(value, m.format)}>
          {formatValue(value, m.format, compact)}
        </p>
      );
    }
    case "bar":
    case "line":
      return (
        <Chart type={visual.type} fieldId={visual.field} measures={visual.measures.map(measure)} rows={rows} horizontal={visual.horizontal} />
      );
    case "map": {
      const all: Record<string, MapMeasure> = Object.fromEntries(template.measures.map((m) => [m.id, measure(m.id)]));
      return <MapChart visual={visual} rows={rows} measures={all} />;
    }
    case "donut":
      return <Chart type="donut" fieldId={visual.field} measures={[measure(visual.measure)]} rows={rows} />;
    case "table": {
      const ms = visual.measures.map(measure);
      return (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                {visual.fields.map((f) => <th key={f} className="px-1 py-2 font-medium">{fieldLabel(f)}</th>)}
                {ms.map((m) => (
                  <th key={m.id} className={`px-1 py-2 font-medium ${m.format === "text" ? "text-left" : "text-right"}`}>{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line/50 last:border-0">
                  {visual.fields.map((f) => <td key={f} className="max-w-56 truncate px-1 py-2">{String(r[f] ?? "")}</td>)}
                  {ms.map((m) => (
                    <td key={m.id} className={`px-1 py-2 ${m.format === "text" ? "max-w-48 truncate text-left" : "text-right font-mono text-xs tabular-nums"}`}>
                      {formatValue(r[m.id], m.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
}

interface VisualGridProps {
  template: Template;
  results: VisualResult[];
}

function VisualGrid({ template, results }: VisualGridProps) {
  if (results.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-12">
      {results.map((result) => (
        <section
          key={result.visual.id}
          className={`card p-5 ${SPAN[result.visual.span]} ${result.visual.type === "kpi" ? "" : "sm:col-span-2"} ${result.visual.type === "text" ? "border-l-4 border-l-brand" : ""}`}
        >
          <h2 className="text-xs font-medium text-muted">{result.visual.title}</h2>
          <VisualBody template={template} result={result} />
        </section>
      ))}
    </div>
  );
}

export function DashboardView({ template, data, totalRows }: DashboardViewProps) {
  const { loose, sections } = buildSections(template, data.visuals);
  return (
    <>
      <FilterBar filters={data.filters} />
      <VisualGrid template={template} results={loose} />
      {sections.map((s) => (
        <section key={s.analysis.id} id={s.anchor} aria-labelledby={`${s.anchor}-titulo`} className="mt-14 scroll-mt-24 first:mt-0">
          <header className="mb-5 border-t border-line pt-6">
            {s.number !== null && <p className="font-mono text-xs tabular-nums text-muted">{String(s.number).padStart(2, "0")}</p>}
            <h2 id={`${s.anchor}-titulo`} className="mt-1 font-serif text-3xl leading-tight tracking-[-0.01em] sm:text-4xl">
              {s.analysis.title}
            </h2>
            {s.analysis.description && <p className="mt-3 max-w-3xl leading-relaxed text-text/75">{s.analysis.description}</p>}
          </header>
          <VisualGrid template={template} results={s.results} />
        </section>
      ))}
      <p className="mt-6 text-right font-mono text-xs text-muted">
        {totalRows.toLocaleString("pt-BR")} linhas na fato · {data.visuals.length} visuais calculados em {data.elapsedMs} ms
      </p>
    </>
  );
}
