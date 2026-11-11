import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/AppShell";
import { ControleActions } from "@/components/controle/ControleActions";
import { PurchaseList, SaleList } from "@/components/controle/EntryLists";
import { EvolutionCharts } from "@/components/controle/EvolutionCharts";
import { Workspace } from "@/components/workspace/Workspace";
import { receiptReaderEnabled } from "@/lib/controle/extract";
import { formatMoney } from "@/lib/controle/money";
import { monthLabel, monthOrCurrent, shiftMonth, todayInBrazil } from "@/lib/controle/schema";
import { cumulative } from "@/lib/controle/series";
import { dailySeries, listPurchases, listSales, monthlySeries, monthTotals } from "@/lib/data/controle";
import { guard } from "@/lib/guard";
import { getControle } from "@/lib/services/controle";
import { loadSpace } from "@/lib/services/space";

export const dynamic = "force-dynamic";

type Tab = "despesas" | "vendas";

interface Props {
  params: Promise<{ org: string; client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Controle · ${(await params).client}` };
}

const single = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

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
  const tab: Tab = single(query.aba) === "vendas" ? "vendas" : "despesas";
  const today = todayInBrazil();
  const month = monthOrCurrent(single(query.mes));
  const currentMonth = today.slice(0, 7);
  const { ctx, space: entries, canRecord } = access;
  const base = `/${ctx.org.slug}/${ctx.client.slug}/controle`;
  const api = `/api/controle/${ctx.org.slug}/${ctx.client.slug}`;
  const href = (to: { tab?: Tab; month?: string }, anchor = ""): string => {
    const m = to.month ?? month;
    const search = new URLSearchParams({ ...((to.tab ?? tab) === "vendas" ? { aba: "vendas" } : {}), ...(m === currentMonth ? {} : { mes: m }) });
    return `${search.size > 0 ? `${base}?${search}` : base}${anchor}`;
  };

  const [space, totals, days, months, purchases, sales] = await Promise.all([
    loadSpace(ctx.org, ctx.client, ctx.membership),
    monthTotals(entries.clientId, month),
    dailySeries(entries.clientId, month),
    monthlySeries(entries.clientId, month),
    tab === "despesas" ? listPurchases(entries.clientId, month) : Promise.resolve([]),
    tab === "vendas" ? listSales(entries.clientId, month) : Promise.resolve([]),
  ]);
  const balance = totals.salesCents - totals.purchasesCents;
  // Each business is opened on its own address; only the platform administrator switches between them here.
  const spaces = space.isPlatformAdmin ? space.spaces : space.spaces.filter((s) => s.current);

  // The screen's own entries in the standard sidebar, styled like the dashboards listed below them.
  const nav = (
    <nav aria-label="Controle">
      <p className="mb-2 text-[13px] text-ink-muted">Controle</p>
      <ul className="border-l border-paper-line">
        {(["despesas", "vendas"] as const).map((t) => (
          <li key={t}>
            <Link
              href={href({ tab: t }, "#lancamentos")}
              aria-current={t === tab ? "page" : undefined}
              className={`-ml-px block border-l py-1 pl-3 pr-1 text-[15px] capitalize leading-snug transition-colors ${
                t === tab ? "border-ink font-medium text-ink" : "border-transparent text-ink/80 hover:border-ink-muted hover:text-ink"
              }`}
            >
              {t}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <Workspace space={{ ...space, spaces }} currentId={null} userName={ctx.user.name} nav={nav}>
      {/* Bottom room so the floating buttons never cover the last entry. */}
      <div className={`mx-auto flex max-w-3xl flex-col gap-4 pt-5 lg:pt-10 ${canRecord ? "pb-24" : ""}`}>
        <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-2">Controle</p>
            <h1 className="text-2xl font-extrabold tracking-tight">{ctx.client.name}</h1>
          </div>
          <nav aria-label="Mês" className="-ml-2 flex shrink-0 items-center justify-between sm:ml-0">
            <Link href={href({ month: shiftMonth(month, -1) })} aria-label="Mês anterior" className="grid size-10 place-items-center rounded-lg text-xl text-muted hover:bg-text/5">‹</Link>
            <p className="min-w-24 text-center text-sm font-semibold first-letter:uppercase">{monthLabel(month)}</p>
            {month < currentMonth ? (
              <Link href={href({ month: shiftMonth(month, 1) })} aria-label="Próximo mês" className="grid size-10 place-items-center rounded-lg text-xl text-muted hover:bg-text/5">›</Link>
            ) : (
              <span className="size-10" aria-hidden />
            )}
          </nav>
        </header>

        <section aria-label="Resumo do mês" className="grid grid-cols-3 gap-2">
          <Kpi label="Vendas" cents={totals.salesCents} detail={count(totals.sales, "venda", "vendas")} />
          <Kpi label="Despesas" cents={totals.purchasesCents} detail={count(totals.purchases, "despesa", "despesas")} />
          <Kpi label="Saldo" cents={balance} detail="no mês" tone={balance < 0 ? "danger" : "ok"} />
        </section>

        <EvolutionCharts month={cumulative(days, today)} months={months} />

        <section id="lancamentos" aria-label="Lançamentos" className="flex scroll-mt-20 flex-col gap-3">
          <nav aria-label="Lançamentos do mês" className="grid grid-cols-2 rounded-xl border border-line p-1">
            {(["despesas", "vendas"] as const).map((t) => (
              <Link
                key={t}
                href={href({ tab: t }, "#lancamentos")}
                aria-current={t === tab ? "page" : undefined}
                className={`rounded-lg py-2.5 text-center text-sm font-semibold capitalize ${t === tab ? "bg-brand text-on-brand" : "text-muted"}`}
              >
                {t}
              </Link>
            ))}
          </nav>
          {!canRecord && <p className="text-sm text-muted">Seu acesso é só de leitura: você vê os lançamentos, mas não cria nem exclui.</p>}
          {tab === "despesas" ? (
            <PurchaseList api={api} purchases={purchases} canRecord={canRecord} />
          ) : (
            <SaleList api={api} sales={sales} canRecord={canRecord} />
          )}
        </section>
      </div>
      {canRecord && <ControleActions api={api} today={today} readerEnabled={receiptReaderEnabled()} />}
    </Workspace>
  );
}
