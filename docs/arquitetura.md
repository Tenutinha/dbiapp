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
