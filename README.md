# DBI — Plataforma de Analytics

Dashboards prontos (recriados a partir dos projetos Power BI / QlikView) que uma **organização** contrata para si e para os **clientes** dela. A equipe da organização "engata" os dados em Parquet/CSV; cada cliente acessa só os próprios dashboards, e qualquer um pode ser compartilhado por link.

```
dbi.app.br/odeontecnologia            ← organização: sumário à esquerda, dashboard à direita
dbi.app.br/odeontecnologia/cliente1   ← espaço do cliente 1 (só os dashboards dele)
dbi.app.br/odeontecnologia/admin      ← admin: clientes, usuários e aparência
dbi.app.br/s/<token>                  ← link de convidado (somente leitura)
```

| Pasta | O que tem |
|---|---|
| `web/src/components/landing/` | Landing page pública — aparece em `dbi.app.br/` para quem não está logado |
| `landing/` | Rascunho estático antigo da landing (referência) |
| `web/` | App (Next.js 15 + Postgres + DuckDB) |
| `docs/arquitetura.md` | Decisões de arquitetura |

## Rodando o app localmente

Pré-requisitos: Node 22+ e Docker.

```bash
cd web
cp .env.example .env.local   # troque DBI_DB_PASSWORD (e a senha dentro de DATABASE_URL)
npm install
npm run db:up                # Postgres 17 em Docker (porta 54329, só localhost)
npm run db:migrate
npm run db:seed              # organizações, clientes e um usuário por papel
npm run sample-data          # gera 1M de vendas de exemplo em web/sample-data/
npm run dev
```

Abra http://localhost:3000. No canto inferior direito, a barra **DEV · entrar como** troca de usuário para testar cada papel (só existe em desenvolvimento).

Para ver um dashboard funcionando: entre como **Ana (admin Odeon)** → *Cliente 1* → **Ativar para Cliente 1** → em **Dados**, suba os 4 arquivos de `web/sample-data/vendas-executivo/` → **Publicar dados**. Depois entre como **João (leitor Cliente 1)**.

## Sumário (sidebar)

Cada espaço (organização ou cliente) mostra à esquerda o sumário dos dashboards, em seções numeradas, e à direita o dashboard aberto. O admin da organização clica em **Organizar sumário** para criar/renomear/remover seções, renomear dashboards, editar o subtítulo e reordenar (arrastando ou com ↑↓). Leitores veem só o que tem dados publicados.

## Aparência (cores e logo)

Em **Administração → Aparência**, o admin define para a organização e, se quiser, para cada cliente:

- **Logo** (PNG, JPG ou WebP até 1 MB; SVG não é aceito por segurança), mostrado no sumário, no celular e nos links de convidado.
- **Cor principal** (botões, destaques, 1ª série dos gráficos) e **cor secundária** (2ª série).
- **Fundo do sumário**: o texto troca sozinho entre claro/escuro para manter contraste AA (≥ 4,5:1).
- **Área do dashboard** clara ou escura.

Um cliente herda tudo da organização e sobrescreve só o que definir. A pré-visualização ao lado mostra o resultado antes de salvar.

## Papéis

| Papel | Onde | Pode |
|---|---|---|
| Admin | equipe da organização | tudo: clientes, usuários, dados e dashboards da org e de todos os clientes |
| Editor de dados | equipe da organização | subir/publicar dados e ativar dashboards (org + todos os clientes) |
| Analista | equipe da organização | ver e compartilhar os dashboards da organização |
| Leitor | equipe da organização | ver os dashboards da organização |
| Analista | cliente | ver e compartilhar os dashboards daquele cliente |
| Leitor | cliente | ver os dashboards daquele cliente |

As regras ficam num único arquivo testado: `web/src/lib/permissions.ts`. O que o usuário não pode ver responde **404**, então ninguém descobre se outra organização ou cliente existe.

## Como funciona

1. **Template** (`web/templates/<id>/template.json`): contrato de dados (tabelas fato/dimensão, colunas, tipos, chaves), relacionamentos, campos, medidas em SQL e layout dos visuais. Validado com Zod ao carregar.
2. **Upload**: cada arquivo é validado contra o contrato (cabeçalhos sem acento/maiúsculas, tipos, nulos, chave única), convertido para Parquet ZSTD ordenado e salvo em `web/storage/<organização>/<dashboard>/v<N>/`.
   - **Fonte bruta** (`source` na tabela): quando o arquivo vem num formato diferente do guardado (ex.: votos por seção do TSE), a tabela declara as colunas do bruto, como derivar cada coluna guardada (`derive`, SQL) e por quais agrupar (`groupBy`, com `SUM(...)`/`any_value(...)` nas demais). O engate confere o arquivo pelas colunas do bruto e grava já transformado; consultas e medidas só veem a tabela guardada.
   - **Dimensão de dimensão**: um relacionamento pode partir de uma dimensão já ligada antes (fato → `d_candidato` → `d_partido`).
3. **Publicação**: o rascunho vira a versão ativa numa transação; tabelas não reenviadas são herdadas da versão anterior. Relações sem correspondência viram aviso.
4. **Consulta**: cada visual vira uma query DuckDB direto nos Parquets. Filtros são sempre parâmetros. O DuckDB roda em sandbox (só lê e escreve dentro de `web/storage/`) e com limite de memória (`DBI_DUCKDB_MEMORY_LIMIT`, padrão 2GB).
5. **Compartilhamento**: links de convidado `/s/<token>` (192 bits, expiração, revogáveis), somente leitura.

## Scripts (`web/`)

| Comando | |
|---|---|
| `npm test` | Testes (permissões, unidade e pipeline completo com DuckDB) |
| `npm run typecheck` / `npm run lint` | Tipos e lint |
| `npm run db:down` | Para o Postgres (os dados ficam no volume) |

## Limitações do MVP

- **Sem login real**: em desenvolvimento, o usuário vem da barra "entrar como"; em produção nenhuma página abre até o Supabase Auth ser ligado em `web/src/lib/auth.ts` (falha fechada de propósito).
- Dar acesso não envia convite por e-mail: o usuário é criado direto no banco.
- Uploads passam pela memória do servidor (`formData`). Para arquivos grandes, o próximo passo é upload direto para o storage (URL assinada).
- Uma tabela fato por template. Excel ainda não é aceito (só CSV e Parquet).
- Os visuais de um dashboard são calculados em sequência (~0,7–0,9 s para 1M de linhas).
