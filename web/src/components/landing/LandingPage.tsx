import Link from "next/link";
import { Logo } from "@/components/AppShell";
import { VitrineSection } from "@/components/vitrine/VitrineSection";
import type { VitrineItem } from "@/lib/vitrine";
import { CONTACT_EMAIL, CONTACT_HREF, FAQ, NAV_LINKS } from "./content";
import { Hero } from "./Hero";
import { Engine, ForClients, HowItWorks, SectionHead, Strip } from "./Sections";

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#topo" aria-label="DBI, início">
          <Logo />
        </a>
        <nav aria-label="Seções" className="hidden gap-7 text-sm text-muted md:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-text">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex gap-2">
          <Link href="/entrar" className="btn btn-ghost hidden sm:inline-flex">
            Entrar
          </Link>
          <Link href="/entrar/cadastro" className="btn btn-ghost hidden md:inline-flex">
            Criar conta
          </Link>
          <a href={CONTACT_HREF} className="btn btn-primary">
            Quero conhecer
          </a>
        </div>
      </div>
    </header>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHead center eyebrow="Dúvidas" title="Perguntas frequentes" />
        <div className="mt-12 grid gap-3">
          {FAQ.map((item) => (
            <details key={item.q} className="landing-faq card px-5 py-4 open:border-[#33405e]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {item.q}
                <span className="landing-faq-icon text-2xl leading-none text-brand" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-[15px] text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-brand/40 bg-[radial-gradient(80%_140%_at_50%_0%,rgba(124,92,255,.35),transparent_60%),var(--color-card)] px-6 py-16 text-center sm:px-10 sm:py-20">
        <SectionHead
          center
          eyebrow="Vamos conversar"
          title={<>Seus dashboards estão prontos. <span className="text-grad">Bora engatar?</span></>}
          sub="Conte quais áreas e quantos clientes você atende. A gente mostra os painéis funcionando com dados de exemplo."
        />
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <a href={CONTACT_HREF} className="btn btn-primary px-5 py-3 text-[15px]">
            Falar com a DBI
          </a>
          <Link href="/entrar/cadastro" className="btn btn-ghost px-5 py-3 text-[15px]">
            Criar conta
          </Link>
          <Link href="/entrar" className="btn btn-ghost px-5 py-3 text-[15px]">
            Entrar na plataforma
          </Link>
        </div>
        <p className="mt-5 text-sm text-muted">
          ou escreva para <a href={CONTACT_HREF} className="text-brand-2 underline-offset-4 hover:underline">{CONTACT_EMAIL}</a>
        </p>
      </div>
    </section>
  );
}

interface LandingPageProps {
  /** Published showcase dashboards, shown right after the hero. */
  vitrine: VitrineItem[];
}

export function LandingPage({ vitrine }: LandingPageProps) {
  return (
    <div id="topo" className="landing overflow-x-clip">
      <Nav />
      <main>
        <Hero />
        <Strip />
        <VitrineSection items={vitrine} className="mx-auto max-w-6xl px-4 py-24 sm:px-6" />
        <HowItWorks />
        <ForClients />
        <Engine />
        <Faq />
        <FinalCta />
      </main>
      <footer className="border-t border-line py-10 text-sm text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <span>© {new Date().getFullYear()} DBI · Dashboards prontos para os seus dados.</span>
        </div>
      </footer>
    </div>
  );
}
