import { formatValue } from "@/lib/format";
import type { DashboardData, VisualResult } from "@/lib/query/run";
import type { Template } from "@/lib/templates/schema";
import { buildSections, offTheAir } from "@/lib/templates/sections";
import { Chart, type ChartMeasure } from "./Chart";
import { FilterBar } from "./FilterBar";
import { LazySection } from "./LazySection";
import { MapChart, type MapMeasure } from "./MapChart";
import { CrossTable } from "./CrossTable";
import { ScrollTable, type ScrollColumn, type SortValue } from "./ScrollTable";
import { VisualCard } from "./VisualCard";

const SPAN: Record<number, string> = {
  1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4",
  5: "md:col-span-5", 6: "md:col-span-6", 7: "md:col-span-7", 8: "md:col-span-8",
  9: "md:col-span-9", 10: "md:col-span-10", 11: "md:col-span-11", 12: "md:col-span-12",
};

interface DashboardViewProps {
  template: Template;
  data: DashboardData;
  totalRows: number;
  /** Analyses not computed with the page: each one is asked for when the reader gets near it. */
  later?: {
    /** Ids of those analyses. */
    pending: readonly string[];
    ticket: string;
    /** The page's filters and picked items, as a query string. */
    search: string;
  };
}

function VisualBody({ template, result }: { template: Template; result: VisualResult }) {
  const { visual, rows, total } = result;
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
        <Chart visualId={visual.id} type={visual.type} fieldId={visual.field} measures={visual.measures.map(measure)} rows={rows} horizontal={visual.horizontal} />
      );
    case "map": {
      const all: Record<string, MapMeasure> = Object.fromEntries(template.measures.map((m) => [m.id, measure(m.id)]));
      return <MapChart visual={visual} rows={rows} measures={all} />;
    }
    case "donut":
      return <Chart visualId={visual.id} type="donut" fieldId={visual.field} measures={[measure(visual.measure)]} rows={rows} />;
    case "rows": {
      const columns: ScrollColumn[] = visual.columns.map((c) => ({
        label: c.label, headClass: "", cellClass: "max-w-64 truncate whitespace-nowrap font-mono", hint: true,
      }));
      const cut = rows.length >= visual.limit;
      const note = !cut
        ? undefined
        : `Estas são as primeiras ${rows.length.toLocaleString("pt-BR")} linhas. ${
            visual.expand && rows.length < visual.expand.limit
              ? `Escolha no filtro "${fieldLabel(visual.expand.filter)}" para ver até ${visual.expand.limit.toLocaleString("pt-BR")}.`
              : "Use os filtros para chegar às demais."
          }`;
      return (
        <ScrollTable dense columns={columns} rows={rows.map((r) => visual.columns.map((_, j) => String(r[`c${j}`] ?? "")))} note={note} />
      );
    }
    case "table": {
      // Leading measures (a value that names the line) come first, then the fields, then the other measures.
      const leading = new Set(visual.leading ?? []);
      const lead = visual.measures.filter((id) => leading.has(id)).map(measure);
      const ms = visual.measures.filter((id) => !leading.has(id)).map(measure);
      const measureColumn = (m: ChartMeasure): ScrollColumn => m.format === "text"
        ? { label: m.label, headClass: "text-left", cellClass: "max-w-48 truncate text-left", hint: true }
        : { label: m.label, headClass: "text-right", cellClass: "text-right font-mono text-xs tabular-nums" };
      const columns: ScrollColumn[] = [
        ...lead.map(measureColumn),
        ...visual.fields.map((f) => ({ label: fieldLabel(f), headClass: "", cellClass: "max-w-56 truncate", hint: true })),
        ...ms.map(measureColumn),
      ];
      const cells = rows.map((r) => [
        ...lead.map((m) => formatValue(r[m.id], m.format)),
        ...visual.fields.map((f) => String(r[f] ?? "")),
        ...ms.map((m) => formatValue(r[m.id], m.format)),
      ]);
      const keys = rows.map((r) => visual.fields.map((f) => String(r[f] ?? "")));
      const raw = (r: (typeof rows)[number], m: ChartMeasure): SortValue => {
        const v = r[m.id];
        return typeof v === "boolean" ? String(v) : v;
      };
      const sortValues: SortValue[][] = rows.map((r, i) => [...lead.map((m) => raw(r, m)), ...keys[i], ...ms.map((m) => raw(r, m))]);
      // The totals line: a label under the first column, nothing under what names the lines, the totals of the rest.
      const footer = total
        ? ["Total", ...[...lead, ...visual.fields].slice(1).map(() => ""), ...ms.map((m) => formatValue(total[m.id], m.format))]
        : undefined;
      const note = rows.length >= visual.limit
        ? `Estas são as primeiras ${rows.length.toLocaleString("pt-BR")} linhas. Use os filtros para chegar às demais.`
        : undefined;
      return (
        <CrossTable
          visualId={visual.id} fields={visual.fields} keys={keys} columns={columns} rows={cells} sortValues={sortValues} note={note}
          initialSort={visual.sort === "field" ? { column: 0, dir: "asc" } : visual.sort === "field_desc" ? { column: 0, dir: "desc" } : undefined}
          footer={footer}
        />
      );
    }
  }
}

interface VisualGridProps {
  template: Template;
  results: VisualResult[];
  /** "row": side by side in a strip that scrolls sideways (the analysis' layout). */
  layout?: "grid" | "row";
}

/** Visuals marked `hideEmpty` leave the page when they have no rows (and did not fail). */
export function visibleResults(results: readonly VisualResult[]): VisualResult[] {
  return results.filter((r) => !(r.visual.hideEmpty && r.rows.length === 0 && !r.error));
}

export function VisualGrid({ template, results: all, layout }: VisualGridProps) {
  const results = visibleResults(all);
  if (results.length === 0) return null;
  if (layout === "row" && results.length > 1) {
    // Each card a little narrower than the page, so the next one peeks in and says the strip goes on.
    return (
      <div
        role="region"
        aria-label="Quadros lado a lado: role para o lado para ver os próximos"
        tabIndex={0}
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-3 focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand"
      >
        {results.map((result) => (
          <VisualCard key={result.visual.id} title={result.visual.title} className="w-[calc(100%-3rem)] shrink-0 snap-start">
            <VisualBody template={template} result={result} />
          </VisualCard>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-12">
      {results.map((result) => (
        <VisualCard
          key={result.visual.id}
          title={result.visual.title}
          className={`${SPAN[result.visual.span]} ${result.visual.type === "kpi" ? "" : "sm:col-span-2"} ${result.visual.type === "text" ? "border-l-4 border-l-brand" : ""}`}
        >
          <VisualBody template={template} result={result} />
        </VisualCard>
      ))}
    </div>
  );
}

export function DashboardView({ template, data, totalRows, later }: DashboardViewProps) {
  const { loose, sections } = buildSections(template, data.visuals);
  const pending = new Set(later?.pending ?? []);
  // Only previews get here with analyses off the air: readers never receive them (withoutHidden).
  const off = offTheAir(template);
  const header = (s: (typeof sections)[number]): React.ReactNode => (
    <header className="mb-5 border-t border-line pt-6">
      {s.number !== null && <p className="font-mono text-xs tabular-nums text-muted">{String(s.number).padStart(2, "0")}</p>}
      {off.has(s.analysis.id) && (
        <p className="w-fit rounded bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
          {s.analysis.hidden ? "Oculta" : "Fora do sumário"}: fora do ar para quem vê o dashboard
        </p>
      )}
      <h2 id={`${s.anchor}-titulo`} className="mt-1 font-serif text-3xl leading-tight tracking-[-0.01em] sm:text-4xl">
        {s.analysis.title}
      </h2>
      {s.analysis.description && <p className="mt-3 max-w-3xl leading-relaxed text-text/75">{s.analysis.description}</p>}
    </header>
  );
  return (
    <>
      <FilterBar filters={data.filters} cross={data.cross} />
      <VisualGrid template={template} results={loose} />
      {sections.map((s) => {
        if (later && pending.has(s.analysis.id)) {
          // Keyed by the filters too: a new selection starts the analysis over, as it does the computed ones.
          return (
            <LazySection
              key={`${s.analysis.id}?${later.search}`}
              ticket={later.ticket} analysisId={s.analysis.id} search={later.search} anchor={s.anchor} header={header(s)}
            />
          );
        }
        if (s.results.length > 0 && visibleResults(s.results).length === 0) return null;
        return (
          <section key={s.analysis.id} id={s.anchor} aria-labelledby={`${s.anchor}-titulo`} className="mt-14 scroll-mt-24 first:mt-0">
            {header(s)}
            <VisualGrid template={template} results={s.results} layout={s.analysis.layout} />
          </section>
        );
      })}
      <p className="mt-6 text-right font-mono text-xs text-muted">
        {totalRows.toLocaleString("pt-BR")} linhas na fato · {data.visuals.length} visuais calculados em {data.elapsedMs} ms
        {pending.size > 0 && " · as demais análises carregam ao chegar nelas"}
      </p>
    </>
  );
}
