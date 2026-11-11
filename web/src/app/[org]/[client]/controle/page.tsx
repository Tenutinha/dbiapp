import type { Metadata } from "next";
import { Forbidden } from "@/components/AppShell";
import { ControleActions } from "@/components/controle/ControleActions";
import { PeriodPicker } from "@/components/controle/PeriodPicker";
import { EntryList } from "@/components/controle/EntryLists";
import { EvolutionCharts } from "@/components/controle/EvolutionCharts";
import { Workspace } from "@/components/workspace/Workspace";
import { mergeEntries } from "@/lib/controle/entries";
import { receiptReaderEnabled } from "@/lib/controle/extract";
import { formatMoney } from "@/lib/controle/money";
import { lastMonth, parsePeriod, periodDays } from "@/lib/controle/period";
import { todayInBrazil } from "@/lib/controle/schema";
import { cumulative, lastDrawnDay } from "@/lib/controle/series";
import { dailySeries, listPurchases, listSales, monthlySeries, periodTotals } from "@/lib/data/controle";
import { guard } from "@/lib/guard";
import { getControle } from "@/lib/services/controle";
import { loadSpace } from "@/lib/services/space";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ org: string; client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Controle · ${(await params).client}` };
}

interface KpiProps {
  label: string;
  cents: number;
  detail: string;
  tone?: "ok" | "danger";
}

function Kpi({ label, cents, detail, tone }: KpiProps) {
  const color = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="card min-w-0 p-3 sm:p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`truncate text-base font-bold tabular-nums sm:text-2xl ${color}`}>{formatMoney(cents)}</p>
      <p className="truncate text-xs text-muted">{detail}</p>
    </div>
  );
}

const count = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * A client's "controle", made for the phone first: the month's numbers and how they evolve, the entries
 * behind them, and two floating buttons — Despesa and Vendas — that open the form of each.
 */
export default async function ControlePage({ params, searchParams }: Props) {
  const { org, client } = await params;
  const access = await guard(getControle(org, client));
  if (access === "forbidden") return <Forbidden />;

  const query = await searchParams;
  const today = todayInBrazil();
  const period = parsePeriod({ mes: query.mes, dias: query.dias });
  const days = periodDays(period, today);
  const oneMonth = period.kind === "months" && period.months.length === 1;
  const { ctx, space: entries, canRecord } = access;
  const base = `/${ctx.org.slug}/${ctx.client.slug}/controle`;
  const api = `/api/controle/${ctx.org.slug}/${ctx.client.slug}`;

  const [space, totals, daily, months, purchases, sales] = await Promise.all([
    loadSpace(ctx.org, ctx.client, ctx.membership),
    periodTotals(entries.clientId, days),
    dailySeries(entries.clientId, days),
    monthlySeries(entries.clientId, lastMonth(period, today)),
    listPurchases(entries.clientId, days),
    listSales(entries.clientId, days),
  ]);
  const balance = totals.salesCents - totals.purchasesCents;

  return (
    <Workspace space={space} currentId={null} userName={ctx.user.name}>
      {/* Bottom room so the floating buttons never cover the last entry. */}
      <div className={`mx-auto flex max-w-3xl flex-col gap-4 pt-5 lg:pt-10 ${canRecord ? "pb-24" : ""}`}>
        <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-2">Controle</p>
            <h1 className="text-2xl font-extrabold tracking-tight">{ctx.client.name}</h1>
          </div>
          <PeriodPicker base={base} period={period} today={today} />
        </header>

        <section aria-label="Resumo do período" className="grid grid-cols-3 gap-2">
          <Kpi label="Vendas" cents={totals.salesCents} detail={count(totals.sales, "venda", "vendas")} />
          <Kpi label="Despesas" cents={totals.purchasesCents} detail={count(totals.purchases, "despesa", "despesas")} />
          <Kpi label="Saldo" cents={balance} detail={oneMonth ? "no mês" : "no período"} tone={balance < 0 ? "danger" : "ok"} />
        </section>

        <EvolutionCharts month={cumulative(daily, lastDrawnDay(daily, today))} months={months} scope={oneMonth ? "no mês" : "no período"} />

        <section id="lancamentos" aria-labelledby="lancamentos-titulo" className="flex scroll-mt-20 flex-col gap-3">
          <h2 id="lancamentos-titulo" className="text-sm font-semibold">Lançamentos {oneMonth ? "do mês" : "do período"}</h2>
          {!canRecord && <p className="text-sm text-muted">Seu acesso é só de leitura: você vê os lançamentos, mas não cria nem exclui.</p>}
          <EntryList api={api} today={today} entries={mergeEntries(purchases, sales)} canRecord={canRecord} />
        </section>
      </div>
      {canRecord && <ControleActions api={api} today={today} readerEnabled={receiptReaderEnabled()} />}
    </Workspace>
  );
}
