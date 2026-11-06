import { ENGINE_FEATURES, ROLES, STEPS } from "./content";

interface SectionHeadProps {
  eyebrow: string;
  title: React.ReactNode;
  sub?: string;
  center?: boolean;
}

export function SectionHead({ eyebrow, title, sub, center }: SectionHeadProps) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <span className="text-[13px] font-semibold tracking-[.14em] text-brand-2 uppercase">{eyebrow}</span>
      <h2 className="mt-3 mb-4 text-[clamp(1.9rem,3.8vw,2.75rem)] leading-[1.1] font-extrabold tracking-[-.03em] text-balance">{title}</h2>
      {sub && <p className="text-[17px] text-muted">{sub}</p>}
    </div>
  );
}

const STEP_ICONS: Record<(typeof STEPS)[number]["icon"], React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  plug: <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5" />,
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
};

export function Strip() {
  const items = [
    ["Power BI", "bg-accent"],
    ["QlikView", "bg-ok"],
    ["Apache Parquet", "bg-brand"],
    ["DuckDB", "bg-brand-2"],
  ] as const;
  return (
    <div className="border-y border-line bg-bg-2 py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 text-sm text-muted sm:px-6">
        <span>Dashboards originados em projetos reais de</span>
        <ul className="flex flex-wrap gap-x-8 gap-y-3 text-base font-bold text-[#b8c0d4]">
          {items.map(([label, color]) => (
            <li key={label} className="flex items-center gap-2">
              <i className={`size-3.5 rounded ${color}`} />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="como-funciona" className="scroll-mt-20 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          center
          eyebrow="Como funciona"
          title={<>Do arquivo ao painel em <span className="text-grad">três passos</span></>}
          sub="A modelagem, as medidas e o visual já existem. A plataforma só precisa dos seus dados."
        />
        <ol className="mt-14 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="card p-7 transition hover:-translate-y-1 hover:border-brand/55">
              <span className="mb-5 grid size-12 place-items-center rounded-xl border border-brand/35 bg-gradient-to-br from-brand/20 to-brand-2/10">
                <svg viewBox="0 0 24 24" className="size-6 stroke-[#cbbcff]" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {STEP_ICONS[s.icon]}
                </svg>
              </span>
              <span className="font-mono text-[13px] text-brand">{s.n}</span>
              <h3 className="mt-2 mb-2 text-xl font-bold tracking-tight">{s.title}</h3>
              <p className="text-[15px] text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ForClients() {
  const tree = [
    ["dbi.app.br/suaempresa", "seus dashboards e todos os clientes"],
    ["dbi.app.br/suaempresa/cliente1", "só os dashboards do cliente 1"],
    ["dbi.app.br/suaempresa/cliente2", "só os dashboards do cliente 2"],
    ["dbi.app.br/s/7fK2x…", "link de convidado, só leitura"],
  ] as const;
  return (
    <section id="clientes" className="scroll-mt-20 border-y border-line bg-bg-2 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <SectionHead
            eyebrow="Para você e seus clientes"
            title={<>Um espaço para cada cliente, <span className="text-grad">com a sua marca</span></>}
            sub="Feita para consultorias e empresas que entregam análise para outras empresas. Você organiza tudo num lugar; cada cliente enxerga só o que é dele."
          />
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {ROLES.map((r) => (
              <div key={r.who} className="card p-5">
                <p className="mb-3 text-sm font-semibold">{r.who}</p>
                <ul className="flex flex-wrap gap-2">
                  {r.roles.map((role) => (
                    <li key={role} className="rounded-lg border border-line bg-white/5 px-2.5 py-1 text-[12.5px] text-[#c3cadb]">
                      {role}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="card overflow-hidden p-0">
          <div className="flex items-center gap-1.5 border-b border-line px-4 py-3" aria-hidden>
            <i className="size-2.5 rounded-full bg-danger/70" />
            <i className="size-2.5 rounded-full bg-accent/70" />
            <i className="size-2.5 rounded-full bg-ok/70" />
          </div>
          <ul className="divide-y divide-line">
            {tree.map(([url, desc], i) => (
              <li key={url} className="flex flex-col gap-0.5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <code className={`font-mono text-[13px] ${i === 0 ? "text-brand-2" : i === 3 ? "text-accent" : "text-text"}`}>{url}</code>
                <span className="text-[13px] text-muted">{desc}</span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-3 gap-3 border-t border-line p-5">
            {[
              ["Logo", "PNG, JPG ou WebP"],
              ["Cores", "principal e secundária"],
              ["Contraste", "ajuste automático AA"],
            ].map(([t, s]) => (
              <div key={t} className="rounded-xl border border-line bg-white/[.03] p-3 text-center">
                <b className="block text-sm">{t}</b>
                <small className="text-[11.5px] text-muted">{s}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Engine() {
  return (
    <section id="motor" className="scroll-mt-20 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <SectionHead
            eyebrow="Motor de dados"
            title={<>Feito para ser <span className="text-grad">rápido de verdade</span></>}
            sub="Fatos e dimensões ficam em Apache Parquet, organizados em modelo estrela, e cada visual vira uma consulta DuckDB que lê só o necessário."
          />
          <ul className="mt-8 grid gap-5">
            {ENGINE_FEATURES.map((f) => (
              <li key={f.title} className="grid grid-cols-[36px_1fr] gap-4">
                <span className="grid size-9 place-items-center rounded-lg border border-brand-2/30 bg-brand-2/10 font-extrabold text-brand-2" aria-hidden>
                  ✓
                </span>
                <div>
                  <b className="block">{f.title}</b>
                  <span className="text-[14.5px] text-muted">{f.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-6">
          <svg viewBox="0 0 440 330" className="h-auto w-full" role="img" aria-labelledby="star-title">
            <title id="star-title">Modelo estrela: tabela fato ligada a quatro dimensões</title>
            <defs>
              <linearGradient id="star-grad" x1="0" x2="1">
                <stop offset="0" stopColor="#7c5cff" />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
            <g stroke="#2c3550" strokeWidth="1.6" strokeDasharray="4 5">
              <path d="M220 165 L80 60" />
              <path d="M220 165 L360 60" />
              <path d="M220 165 L80 270" />
              <path d="M220 165 L360 270" />
            </g>
            <g fontSize="12" fill="#e8ecf5">
              {[
                [20, 34, "dim_cliente", "48 mil linhas"],
                [300, 34, "dim_produto", "3,2 mil linhas"],
                [20, 244, "dim_calendario", "3.650 linhas"],
                [300, 244, "dim_loja", "212 linhas"],
              ].map(([x, y, name, rows]) => (
                <g key={name} transform={`translate(${x} ${y})`}>
                  <rect width="120" height="52" rx="11" fill="#161c2c" stroke="#2c3550" />
                  <text x="14" y="23" fontWeight="700">{name}</text>
                  <text x="14" y="40" fill="#8d97ad" fontSize="10.5">{rows}</text>
                </g>
              ))}
              <g transform="translate(140 126)">
                <rect width="160" height="78" rx="14" fill="#111623" stroke="url(#star-grad)" strokeWidth="2" />
                <text x="18" y="28" fontWeight="800" fontSize="14">fato_vendas</text>
                <text x="18" y="47" fill="#8d97ad" fontSize="10.5">milhões de linhas</text>
                <text x="18" y="63" fill="#22d3ee" fontSize="10.5" fontFamily="monospace">ordenada por data</text>
              </g>
            </g>
          </svg>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              ["~10×", "menor que CSV"],
              ["colunar", "lê só o que usa"],
              ["0", "licença por usuário"],
            ].map(([b, s]) => (
              <div key={s} className="rounded-xl border border-line bg-white/[.03] p-3 text-center">
                <b className="text-grad block text-xl tracking-tight">{b}</b>
                <small className="text-xs text-muted">{s}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
