# DBI — Arquitetura inicial (rascunho)

## Conceitos

| Conceito | O que é |
|---|---|
| **Workspace** | Espaço isolado de um assinante (empresa/área). |
| **Template de dashboard** | Dashboard pronto do catálogo (origem Power BI ou QlikView). |
| **Contrato de dados** | Lista de tabelas que o template exige: fatos, dimensões, colunas, tipos e chaves. |
| **Dataset** | Arquivos Parquet que o assinante subiu para cumprir um contrato. Versionado. |
| **Instância** | Template + dataset de um workspace = dashboard "engatado". |
| **Compartilhamento** | Membro do workspace (papel) ou link de convidado (expiração, senha, só leitura). |

## Fluxo de dados

```
upload (Parquet / CSV / Excel)
   → validação contra o contrato (colunas, tipos, chaves, nulos)
   → conversão/normalização para Parquet (particionado por mês nas fatos)
   → armazenado em  storage/<workspace>/<dataset>/<versão>/<tabela>.parquet
   → versão marcada como "ativa" só depois de validada (troca atômica)
   → dashboard consulta via DuckDB
```

## Stack proposta (fase local → Supabase)

| Camada | Agora (local) | Depois |
|---|---|---|
| Metadados (usuários, workspaces, contratos, permissões, links) | **Postgres em Docker** | Supabase Postgres (mesmas migrations) |
| Arquivos Parquet | Pasta local `storage/` | Supabase Storage (ou S3/R2) |
| Motor de consulta | **DuckDB** lendo Parquet direto | DuckDB no backend e/ou DuckDB-WASM no navegador |
| Auth | Sessão simples / Auth.js | Supabase Auth |

Por que Postgres local e não SQLite: a migração para o Supabase vira só trocar a connection string — mesmas migrations, mesmos tipos, e dá para já desenhar as políticas de RLS por workspace.

Por que DuckDB: lê Parquet nativamente, faz *projection* e *predicate pushdown* (lê só as colunas/partições do filtro), roda junções do modelo estrela em milissegundos para dezenas de milhões de linhas, e não precisa de servidor próprio.

## ✅ Decisão (2026-11-06): dashboards recriados na web

Os `.pbix` e `.qvw` não conseguem ler o Parquet da plataforma quando embutidos numa web app, e o Power BI Embedded exige capacidade paga no Azure (o QlikView nem tem equivalente). Por isso, **os dashboards serão recriados na web**:

- Os projetos Power BI/QlikView viram a **especificação**: modelo estrela, medidas (DAX/expressões Qlik) e layout dos visuais.
- Cada template é um pacote declarativo:
  - `contract`: tabelas, colunas, tipos e chaves esperadas
  - `measures`: medidas traduzidas para SQL (DuckDB)
  - `layout`: cards, gráficos e filtros
- O frontend renderiza o layout (ex.: React + ECharts) e cada visual vira uma consulta SQL no DuckDB sobre o Parquet do workspace.
- Vantagens: sem licença por usuário, compartilhamento por link sob nosso controle, performance colunar direta no Parquet.
- Custo: traduzir as medidas DAX/Qlik para SQL, uma vez por template.

## ✅ Decisão (2026-11-06): organizações e clientes

O modelo de negócio é B2B2B: uma **organização** (ex.: Odeon Tecnologia) contrata a DBI para os dashboards dela e dos **clientes** dela.

- URLs: `/<org>` (dashboards da organização + clientes), `/<org>/<cliente>` (só os dashboards do cliente), `/<org>/admin`.
- `dashboard_instances.client_id` nulo = dashboard da própria organização; preenchido = do cliente. FK composta garante que o cliente é da mesma organização.
- Equipe da organização (`organization_members`): admin, editor, analista, leitor. Admin e editor enxergam todos os clientes; analista e leitor, só a organização.
- Usuários de cliente (`client_members`): analista (vê e compartilha) ou leitor. **Nunca sobem dados** — isso é da equipe da organização.
- Regras de acesso centralizadas e testadas em `web/src/lib/permissions.ts`; o que não pode ser visto responde 404.
- Na migração para o Supabase, essas mesmas tabelas viram a base das políticas de RLS.
- A página `/<org>/admin` está documentada em [admin-organizacao.md](admin-organizacao.md).

## ✅ Decisão (2026-11-09): administração da organização numa tabela só, com modais

A configuração de uma organização virou **um único objeto**: a tabela de `/<org>/admin`, lida como hierarquia
**espaço (organização / cliente) → dashboard → dados → acessos**. Tudo o que antes eram páginas ou seções
separadas abre em **modais no centro da tela**, com endereço próprio (`?dados=`, `?tema=`, `?sumario=`), para que o
admin nunca saia da tabela. Detalhes de uso em [admin-organizacao.md](admin-organizacao.md).

- **Escolha de dashboard**: seletor estilo vitrine com todo o catálogo publicado — busca por nome, assunto e
  análise; destaque com análises, visuais e tabelas que ele pede; capas geradas a partir dos visuais.
- **Dados ("engate")**: mapa de conexões arquivo → tabela do contrato, com conferência de colunas **antes**
  de gravar (fio verde/vermelho), engate com animação e upload pela tomada de cada tabela.
- **Filtro dos dados**: regras sobre colunas da tabela fato (manter só / excluir valores) que valem para a
  tela, os links compartilhados e as opções dos filtros. Aplicado na consulta (subconsulta filtrada da fato,
  valores sempre como parâmetros); os arquivos nunca mudam. Lido dentro de `loadDashboard`, nunca pelo chamador.
- **Tema por espaço**: logo, cores, área clara/escura e **fundo do dashboard**, do qual cartões, linhas e
  texto derivam com contraste mínimo de 4,5:1.
- **Acessos**: avatares compactos na tabela; "Gerenciar usuários" abre a lista completa e o formulário.
- **Tema da plataforma**: botão claro/escuro no topo, guardado por navegador (padrão via `DBI_TEMA_PADRAO`).

Migrações desta etapa, **aplicadas no Supabase de produção em 2026-11-09**:

| Migração | O que faz |
|----------|-----------|
| `010_instance_data_filter.sql` | `dashboard_instances.data_filter` (JSON, padrão `[]`) — filtro dos dados |
| `011_branding_background.sql` | `space_branding.background_color` (hex ou NULL) — fundo do dashboard |

O código lê os dois campos via `to_jsonb(...)`, então continua funcionando num banco sem as migrações
(sem filtro / sem fundo); só salvar avisa que a migração falta. Para o banco local: `npm --prefix web run db:migrate`.

**Conexão da produção com o banco:** na Vercel, o `DATABASE_URL` precisa usar o **pooler compartilhado** do
Supabase (`aws-0-us-east-2.pooler.supabase.com:6543`, usuário `postgres.<ref>`). O host direto
(`db.<ref>.supabase.co:5432`) só tem IPv6, que as funções da Vercel não alcançam — as páginas que consultam o
banco ficavam carregando até o limite de 300 s (corrigido em 2026-11-09). O código reconhece a porta 6543 e
ajusta a conexão (sem prepared statements, poucas conexões por instância) em `web/src/lib/db.ts`.

## ✅ Decisão (2026-11-09): cabeçalho com logo e avatar, e "Meu perfil"

O topo das telas da plataforma (home, admin, vitrine, dados) tem **o logo da DBI à esquerda** (volta ao início)
e **o avatar da pessoa à direita**. Passar o mouse no avatar (ou focar/tocar) abre o menu: a organização da página
e sua administração, tema claro/escuro, **Meu perfil** e Sair. Sem login, o topo mostra o logo e o botão de tema.

- **Meu perfil** (modal central): nome, e-mail, desde quando, "Admin master", onde a pessoa tem acesso (com o
  papel em cada organização/cliente), **troca de senha** sem sair da página e **avatar** (PNG/JPG/WebP até 1 MB,
  validado pelo conteúdo, com prévia). O avatar aparece no menu e nas listas de acesso da admin.
- Avatar guardado em `users/<id>/avatar/<uuid>.<ext>` no armazenamento e servido em `/api/users/avatar/<uuid>`
  (id impossível de adivinhar, como os logos). Colunas em `users` pela **migração 012**; antes dela, todos aparecem
  com as iniciais e só o envio avisa que a migração falta.
- A troca de senha usa a mesma regra da página `/entrar/nova-senha` (`web/src/lib/password.ts`).
- Código: `web/src/components/user-menu/` (menu, modal e painel), `web/src/app/perfil/actions.ts`,
  `web/src/lib/data/users.ts`, `web/src/lib/services/avatar.ts`.
- Ainda com o "Sair" antigo: a barra lateral da tela do dashboard (`Workspace`), que não usa este cabeçalho.

## ✅ Decisão (2026-11-09): barra lateral da tela do dashboard

A barra lateral de `/<org>` e `/<org>/<cliente>` (a tela onde os dashboards abrem):

- **Topo:** o **nome da organização** (no lugar do logo da DBI), levando à página da organização quando a pessoa
  pode abri-la; o botão de recolher continua ao lado.
- **Logo do espaço** (tema da organização/cliente) logo abaixo e, embaixo dele, o **seletor de clientes**: quem
  acessa mais de um espaço (admins, editores) escolhe a organização ou um cliente numa lista agrupada
  ("Organização" / "Clientes") e o espaço abre na hora; quem acessa só um vê apenas o nome dele. Substitui o antigo
  "Outros espaços" do rodapé. Lista montada em `web/src/lib/space-options.ts` (testada).
- **Rodapé:** quem está logado e "Administração" (para admins); embaixo, o **logo da DBI** (volta ao início) **ao lado
  do Sair**.
- **Sem edição do sumário aqui:** o antigo "Organizar sumário" saiu da barra lateral e foi para a admin — link
  "Organizar sumário →" na coluna Dashboard de cada espaço, abrindo um modal central (`?sumario=<org | cliente>`).

Código: `web/src/components/workspace/SidebarShell.tsx`, `SpaceSwitcher.tsx` e `Workspace.tsx`.
