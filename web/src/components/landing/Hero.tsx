import Link from "next/link";
import { CONTACT_HREF } from "./content";

const BARS = [42, 58, 49, 66, 61, 78, 72, 88, 83, 96] as const;

function DashboardMock() {
  return (
    <div className="relative mx-auto w-full max-w-xl lg:mx-0" aria-hidden>
      <div className="flex overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-card-2 to-card shadow-[0_40px_80px_-30px_rgba(0,0,0,.8)] lg:[transform:perspective(1400px)_rotateY(-7deg)_rotateX(3deg)]">
        <aside className="hidden w-36 shrink-0 flex-col gap-2 border-r border-line bg-[#1d1640] p-3 text-[11px] sm:flex">
          <span className="mb-1 flex items-center gap-1.5 font-bold text-white">
            <span className="size-4 rounded bg-accent" /> Cliente 1
          </span>
          <span className="text-white/50">1 · Comercial</span>
          <span className="rounded-md bg-white/10 px-2 py-1 text-white">Visão executiva</span>
          <span className="px-2 text-white/60">Carteira</span>
          <span className="mt-1 text-white/50">2 · Financeiro</span>
          <span className="px-2 text-white/60">DRE gerencial</span>
        </aside>
        <div className="min-w-0 flex-1 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-bold">
              Visão Executiva de Vendas
              <span className="block font-mono text-[10.5px] font-medium text-muted">dbi.app.br/odeon/cliente1</span>
            </p>
            <span className="flex items-center gap-1.5 text-[11px] text-ok">
              <i className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_var(--color-ok)]" /> publicado
            </span>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[
              ["Receita", "R$ 4,82M", "▲ 12,4%"],
              ["Ticket médio", "R$ 318", "▲ 3,1%"],
              ["Margem", "34,7%", "▲ 1,8 pp"],
            ].map(([label, value, delta]) => (
              <div key={label} className="rounded-xl border border-line bg-white/[.03] px-2.5 py-2">
                <small className="text-[10px] text-muted">{label}</small>
                <p className="text-sm font-bold tracking-tight whitespace-nowrap sm:text-base">{value}</p>
                <em className="text-[10px] not-italic text-ok">{delta}</em>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[1.6fr_1fr] gap-2">
            <div className="flex h-28 items-end gap-1.5 rounded-xl border border-line bg-white/[.03] p-2.5">
              {BARS.map((h, i) => (
                <i
                  key={i}
                  className="landing-bar flex-1 rounded-t bg-gradient-to-b from-brand-2 to-brand"
                  style={{ height: `${h}%`, animationDelay: `${i * 0.05}s` }}
                />
              ))}
            </div>
            <div className="rounded-xl border border-line bg-white/[.03] p-2">
              <svg viewBox="0 0 120 110" className="h-full w-full">
                <circle cx="60" cy="55" r="38" fill="none" stroke="#222a3d" strokeWidth="14" />
                <circle cx="60" cy="55" r="38" fill="none" stroke="#7c5cff" strokeWidth="14" strokeDasharray="120 239" transform="rotate(-90 60 55)" />
                <circle cx="60" cy="55" r="38" fill="none" stroke="#22d3ee" strokeWidth="14" strokeDasharray="70 239" strokeDashoffset="-120" transform="rotate(-90 60 55)" />
                <circle cx="60" cy="55" r="38" fill="none" stroke="#f5b83d" strokeWidth="14" strokeDasharray="40 239" strokeDashoffset="-190" transform="rotate(-90 60 55)" />
                <text x="60" y="60" textAnchor="middle" fill="#e8ecf5" fontSize="15" fontWeight="700">62%</text>
              </svg>
            </div>
          </div>
        </div>
      </div>
      <div className="landing-float absolute -bottom-6 left-2 flex items-center gap-2.5 rounded-2xl border border-line bg-card/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur sm:-left-8">
        <span className="grid size-8 place-items-center rounded-lg bg-brand/20 font-mono text-[11px] font-bold text-[#cbbcff]">PQ</span>
        <div>
          fato_vendas.parquet
          <small className="block text-[11px] text-muted">1 M linhas · validado</small>
        </div>
      </div>
      <div className="landing-float absolute -top-12 right-2 flex items-center gap-2.5 rounded-2xl border border-line bg-card/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur [animation-delay:-3s] sm:-right-4">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-2/20 font-bold text-brand-2">↗</span>
        <div>
          Link de convidado
          <small className="block text-[11px] text-muted">somente leitura · expira em 7 dias</small>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-16 pb-24 sm:pt-24">
      <div className="landing-glow" aria-hidden />
      <div className="landing-grid" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/35 bg-brand/10 py-1 pr-3.5 pl-1.5 text-[13px] text-[#c7b8ff]">
            <b className="rounded-full bg-brand px-2 py-0.5 text-[11px] tracking-wide text-white">B2B</b>
            Dashboards para você e para os seus clientes
          </span>
          <h1 className="text-[clamp(2.4rem,5.4vw,4rem)] leading-[1.04] font-extrabold tracking-[-.035em] text-balance">
            Os dashboards já estão prontos. <span className="text-grad">Só falta engatar os dados.</span>
          </h1>
          <p className="mt-6 mb-9 max-w-xl text-lg text-muted">
            Painéis de nível Power BI e QlikView rodando direto no navegador. Sua equipe sobe os dados em Parquet ou CSV e cada
            cliente recebe o próprio espaço — com a sua marca, sem licença por usuário.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={CONTACT_HREF} className="btn btn-primary px-5 py-3 text-[15px]">
              Quero conhecer
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
            <Link href="/entrar" className="btn btn-ghost px-5 py-3 text-[15px]">
              Já tenho acesso
            </Link>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-muted">
            {["Sem modelagem do zero", "Um espaço por cliente", "Login sem senha"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <i className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_var(--color-ok)]" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <DashboardMock />
      </div>
    </section>
  );
}
