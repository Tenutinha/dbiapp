import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader, Forbidden } from "@/components/AppShell";
import { PurchaseList, SaleList } from "@/components/controle/EntryLists";
import { PurchaseCapture } from "@/components/controle/PurchaseCapture";
import { SaleForm } from "@/components/controle/SaleForm";
import { orgActions } from "@/lib/access";
import { receiptReaderEnabled } from "@/lib/controle/extract";
import { formatMoney } from "@/lib/controle/money";
import { monthLabel, monthOrCurrent, shiftMonth, todayInBrazil } from "@/lib/controle/schema";
import { listKnownProducts, listPurchases, listSales, monthTotals } from "@/lib/data/controle";
import { guard } from "@/lib/guard";
import { getControle } from "@/lib/services/controle";

export const dynamic = "force-dynamic";

type Tab = "compras" | "vendas";

interface Props {
  params: Promise<{ org: string; client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Controle · ${(await params).client}` };
}

const single = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

interface TotalProps {
  label: string;
  cents: number;
  detail: string;
  tone?: "ok" | "danger";
}

function Total({ label, cents, detail, tone }: TotalProps) {
  const color = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="card min-w-0 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`truncate text-base font-bold tabular-nums sm:text-lg ${color}`}>{formatMoney(cents)}</p>
      <p className="truncate text-xs text-muted">{detail}</p>
    </div>
  );
}

const count = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * A client's "controle": purchases (photographed, read by AI, checked) and sales, month by month.
 * Made for the phone first — it is what the installed app opens for organizations with the module on.
 */
export default async function ControlePage({ params, searchParams }: Props) {
  const { org, client } = await params;
  const access = await guard(getControle(org, client));
  if (access === "forbidden") return <Forbidden />;

  const query = await searchParams;
  const tab: Tab = single(query.aba) === "vendas" ? "vendas" : "compras";
  const today = todayInBrazil();
  const month = monthOrCurrent(single(query.mes));
  const currentMonth = today.slice(0, 7);
  const { ctx, space, canRecord } = access;
  const base = `/${ctx.org.slug}/${ctx.client.slug}/controle`;
  const api = `/api/controle/${ctx.org.slug}/${ctx.client.slug}`;
  const href = (to: { tab?: Tab; month?: string }): string => {
    const m = to.month ?? month;
    const search = new URLSearchParams({ ...((to.tab ?? tab) === "vendas" ? { aba: "vendas" } : {}), ...(m === currentMonth ? {} : { mes: m }) });
    return search.size > 0 ? `${base}?${search}` : base;
  };

  const [totals, purchases, sales, products] = await Promise.all([
    monthTotals(space.clientId, month),
    tab === "compras" ? listPurchases(space.clientId, month) : Promise.resolve([]),
    tab === "vendas" ? listSales(space.clientId, month) : Promise.resolve([]),
    tab === "vendas" && canRecord ? listKnownProducts(space.clientId) : Promise.resolve([]),
  ]);
  const balance = totals.salesCents - totals.purchasesCents;

  return (
    <>
      <AppHeader org={ctx.org} isAdmin={orgActions(ctx).has("admin")} userName={ctx.user.name} />
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-16 pt-5">
        <header className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-2">Controle</p>
          <h1 className="text-2xl font-extrabold tracking-tight">{ctx.client.name}</h1>
        </header>

        <nav aria-label="Mês" className="flex items-center justify-between">
          <Link href={href({ month: shiftMonth(month, -1) })} aria-label="Mês anterior" className="grid size-11 place-items-center rounded-lg text-xl text-muted hover:bg-text/5">‹</Link>
          <p className="text-sm font-semibold first-letter:uppercase">{monthLabel(month)}</p>
          {month < currentMonth ? (
            <Link href={href({ month: shiftMonth(month, 1) })} aria-label="Próximo mês" className="grid size-11 place-items-center rounded-lg text-xl text-muted hover:bg-text/5">›</Link>
          ) : (
            <span className="size-11" aria-hidden />
          )}
        </nav>

        <section aria-label="Resumo do mês" className="grid grid-cols-3 gap-2">
          <Total label="Vendas" cents={totals.salesCents} detail={count(totals.sales, "venda", "vendas")} />
          <Total label="Compras" cents={totals.purchasesCents} detail={count(totals.purchases, "compra", "compras")} />
          <Total label="Saldo" cents={balance} detail="no mês" tone={balance < 0 ? "danger" : "ok"} />
        </section>

        <nav aria-label="Lançamentos" className="grid grid-cols-2 rounded-xl border border-line p-1">
          {(["compras", "vendas"] as const).map((t) => (
            <Link
              key={t}
              href={href({ tab: t })}
              aria-current={t === tab ? "page" : undefined}
              className={`rounded-lg py-2.5 text-center text-sm font-semibold capitalize ${t === tab ? "bg-brand text-on-brand" : "text-muted"}`}
            >
              {t}
            </Link>
          ))}
        </nav>

        {!canRecord && <p className="text-sm text-muted">Seu acesso é só de leitura: você vê os lançamentos, mas não cria nem exclui.</p>}

        {tab === "compras" ? (
          <>
            {canRecord && <PurchaseCapture api={api} today={today} readerEnabled={receiptReaderEnabled()} />}
            <PurchaseList api={api} purchases={purchases} canRecord={canRecord} />
          </>
        ) : (
          <>
            {canRecord && <SaleForm api={api} today={today} products={products} />}
            <SaleList api={api} sales={sales} canRecord={canRecord} />
          </>
        )}
      </main>
    </>
  );
}
