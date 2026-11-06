/** Copy and static data for the public landing page (dbi.app.br/). */

export const CONTACT_EMAIL = "contato@dbi.app.br";
export const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Quero conhecer a DBI")}`;

export const NAV_LINKS = [
  { href: "/vitrine", label: "Vitrine" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#clientes", label: "Para seus clientes" },
  { href: "#motor", label: "Performance" },
  { href: "#faq", label: "Dúvidas" },
] as const;

export const STEPS = [
  {
    n: "01",
    title: "Escolha os dashboards",
    text: "Painéis prontos, recriados a partir de projetos reais de Power BI e QlikView — com as mesmas medidas e regras de negócio. Ative para a sua organização ou para cada cliente.",
    icon: "grid",
  },
  {
    n: "02",
    title: "Engate os dados",
    text: "Cada dashboard mostra as tabelas que espera. Sua equipe sobe fatos e dimensões em Parquet ou CSV; validamos colunas e tipos antes de publicar.",
    icon: "plug",
  },
  {
    n: "03",
    title: "Entregue e compartilhe",
    text: "Cada cliente acessa só o que é dele, com a sua marca. Para quem não tem conta, um link de leitura com validade resolve.",
    icon: "share",
  },
] as const;

export const ENGINE_FEATURES = [
  { title: "Parquet + DuckDB", text: "Formato colunar e comprimido; cada filtro lê só as colunas que precisa, direto no arquivo." },
  { title: "Validação no upload", text: "Colunas, tipos e chaves conferidos contra o contrato do dashboard antes de ir ao ar." },
  { title: "Publicação sem quebra", text: "A nova versão dos dados só entra depois de validada; ninguém vê um painel pela metade." },
  { title: "Dados isolados", text: "Cada organização e cada cliente enxergam apenas o próprio espaço. O resto responde 404." },
] as const;

export const ROLES = [
  { who: "Equipe da organização", roles: ["Admin", "Editor de dados", "Analista", "Leitor"] },
  { who: "Usuários do cliente", roles: ["Analista", "Leitor"] },
] as const;

export const FAQ = [
  {
    q: "Preciso de licença de Power BI ou QlikView?",
    a: "Não. Os dashboards foram desenhados nessas ferramentas e recriados na web, com as mesmas medidas. Quem acessa usa só o navegador — sem licença por usuário.",
  },
  {
    q: "Quem sobe os dados?",
    a: "A equipe da organização (admin ou editor de dados). Seus clientes só visualizam e, se você permitir, compartilham — nunca mexem nos dados.",
  },
  {
    q: "Meus dados não estão em Parquet. E agora?",
    a: "Pode mandar CSV. A plataforma valida o arquivo contra o contrato do dashboard e grava em Parquet, já com os tipos certos.",
  },
  {
    q: "Dá para colocar a marca da minha empresa?",
    a: "Sim. Logo, cor principal, cor secundária e fundo do menu — para a organização e, se quiser, diferente para cada cliente. O contraste do texto se ajusta sozinho.",
  },
  {
    q: "Como funciona o login?",
    a: "Sem senha: a pessoa recebe um link de acesso no e-mail. Só entra quem foi convidado por um admin.",
  },
] as const;
