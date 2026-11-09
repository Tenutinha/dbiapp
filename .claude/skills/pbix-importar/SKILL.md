---
name: pbix-importar
description: Converte um projeto Power BI (.pbix) em um dashboard da DBI (template.json + Parquet). Lê tabelas, colunas, relacionamentos, medidas DAX, páginas e visuais; traduz DAX para SQL do DuckDB; valida no motor real e entrega um relatório do que foi convertido, aproximado ou deixado de fora. Use quando o usuário enviar/apontar um .pbix ou pedir para importar/converter um dashboard do Power BI.
---

# Importar .pbix para a DBI

O resultado é um rascunho para revisão. A pessoa confere no cadastro (modal de dashboards) antes de publicar. Responda sempre em pt-BR.

## Pastas

- Skill: `.claude/skills/pbix-importar/` (extrator Python em `scripts/`).
- Validador: `web/scripts/pbix/validar-template.ts`, que usa o `templateSchema` e o motor de consulta do app.
- Saída: `%USERPROFILE%\dbi-importacoes\<id>\`, **fora do repositório**. Os dados são de cliente e nunca são commitados.
  - `extracao.json`
  - `dados/*.parquet`
  - `template.json`
  - `relatorio.md`

## Passo 1: extrair

```bash
uv run --no-project --python 3.11 --with pbixray --with "kaitaistruct>=0.11" --with pyarrow \
  python -I .claude/skills/pbix-importar/scripts/extrair_pbix.py "<arquivo.pbix>" \
  --saida "$USERPROFILE/dbi-importacoes/<id>" --dados
```

- `<id>` é o slug do nome do arquivo (`[a-z0-9-]`).
- Para tabelas gigantes, use `--max-linhas 200000` para gerar uma amostra; avise que é amostra.
- Sem `DataModel` (Live Connection) só vem o layout. Nesse caso o modelo tem de ser montado com a pessoa.
- Em DirectQuery não há dados. Avise; os Parquet virão depois pelo upload normal.

Leia `extracao.json`:

- `modelo.tabelas`: traz o `nome` (já em snake_case) e as colunas com `tipo` da DBI. As tabelas `interna: true` (LocalDateTable/DateTableTemplate) são as datas automáticas do PBI e devem ser ignoradas.
- `modelo.relacionamentos`, `modelo.medidas` (expressões DAX), `modelo.colunas_calculadas`, `modelo.power_query`.
- `relatorio.paginas[].visuais[]`: traz `tipo_pbi`, `titulo`, `span_sugerido`, `texto` e os `papeis`. Cada papel (Category, Y, Values, Rows…) lista os campos usados:
  - `tipo: coluna | medida | agregacao | nivel_hierarquia`;
  - `funcao` (só em agregação): Sum, Avg, Min, Max, `Count` = contagem **distinta**, `CountNonNull` = contagem.

## Passo 2: montar o `template.json`

Siga o formato de `web/src/lib/templates/schema.ts`. Os exemplos de referência são `web/templates/vendas-executivo/template.json` e `web/templates/eleicoes-presidente/template.json`. Use `origin: "powerbi"` e `version: 1`.

**O template é um molde do catálogo, não o dashboard de um cliente.** Qualquer organização deve poder ativá-lo trazendo dados na mesma estrutura. Por isso:

- `id`, `name` e `description` descrevem a análise, por exemplo `vendas-filiais-produtos` / "Vendas por filial, produto e cliente".
- Nunca cite o cliente, a organização nem o nome do arquivo .pbix.
- O mesmo vale para títulos de seções e visuais, e para descrições de tabelas e colunas.
- O nome do cliente aparece só no espaço da organização, onde o dashboard é ativado.
- Na pasta de saída, use um slug genérico.

### Modelo

- **Uma única tabela `fact`.** Escolha a que está do lado "muitos" da maioria dos relacionamentos e que alimenta as medidas.
- **As demais tabelas viram `dimension`**, com `key` = coluna do lado "um".
- **Relacionamentos sempre partem da fato.** Em floco de neve (dimensão → dimensão), achate: inclua as colunas da sub-dimensão na dimensão, com um JOIN feito no DuckDB sobre os Parquet ao gerar o arquivo final, e registre no relatório.
- **Mais de uma fato:** pergunte qual vira o dashboard. A outra pode virar outro template.
- **Tabelas e colunas não usadas** por medidas, visuais ou relacionamentos ficam fora do contrato. Isso não se aplica a colunas-chave.
- **`sortBy` da fato:** as colunas mais filtradas, por exemplo a data.
- **Colunas calculadas** já vêm materializadas no Parquet. Use-as como colunas normais.

### Campos (`fields`)

São as colunas usadas em eixos, linhas de tabela, legendas e segmentações. O `sql` é `tabela.coluna`.

Níveis de hierarquia de data (`nivel_hierarquia` com nível Ano/Trimestre/Mês/Dia) viram campos derivados:

| Nível | `sql` do campo |
|---|---|
| Ano | `CAST(year(t.data) AS VARCHAR)` |
| Mês | `strftime(t.data, '%Y-%m')` |
| Trimestre | `CAST(year(t.data) AS VARCHAR) \|\| '-T' \|\| CAST(quarter(t.data) AS VARCHAR)` |

### Medidas (`measures`): DAX → SQL do DuckDB

O `sql` já inclui a agregação e deve passar no SAFE_SQL: sem `;`, sem `--`, sem aspas duplas, sem `read_`, `copy` e afins. Formatos possíveis: currency | number | integer | percent | text. Use `formatString` ou o nome da medida como pista.

| DAX | SQL |
|---|---|
| `SUM(T[c])` | `SUM(t.c)` |
| `AVERAGE` / `MIN` / `MAX` | `AVG` / `MIN` / `MAX` |
| `COUNT(T[c])` / `COUNTROWS(T)` | `COUNT(t.c)` / `COUNT(*)` |
| `DISTINCTCOUNT(T[c])` | `COUNT(DISTINCT t.c)` |
| `DIVIDE(a, b)` | `(a) / NULLIF(b, 0)` |
| `CALCULATE(SUM(T[v]), T[x] = "A")` | `SUM(CASE WHEN t.x = 'A' THEN t.v END)` |
| `CALCULATE(..., T[x] IN {"A","B"})` | `CASE WHEN t.x IN ('A','B') ...` |
| `SUMX(T, T[a] * T[b])` | `SUM(t.a * t.b)` |
| `IF(cond, a, b)` | `CASE WHEN cond THEN a ELSE b END` |
| Medida que referencia `[Outra Medida]` | Expanda inline a expressão SQL da outra medida |
| Agregação implícita do visual (`agregacao`) | Crie uma medida, por exemplo `soma_valor` = `SUM(t.valor)` |

**Sem tradução fiel.** Não invente nada para estes casos: deixe fora e liste no relatório como **pendência**.

- `ALL`/`ALLEXCEPT`/`REMOVEFILTERS`: percentual do total exige ignorar filtros, e o motor não faz isso.
- Inteligência de tempo: `SAMEPERIODLASTYEAR`, `TOTALYTD`, `DATEADD`, `PARALLELPERIOD`.
- `RANKX`, `USERELATIONSHIP`, `TREATAS`, variáveis complexas e grupos de cálculo.

Ponto de atenção: as medidas usam `fato.coluna` e `dimensao.coluna`, porque os aliases são os nomes das tabelas.

### Visuais

| `tipo_pbi` | DBI |
|---|---|
| card, multiRowCard, kpi | `kpi` (um por medida) |
| clusteredBarChart, stackedBarChart | `bar` com `horizontal: true` |
| clusteredColumnChart, stackedColumnChart, ribbonChart, waterfallChart | `bar` |
| lineChart, areaChart, stackedAreaChart, lineClusteredColumnComboChart | `line` (combo: as duas medidas na mesma linha) |
| pieChart, donutChart, treemap, funnel | `donut` (limite ≤ 20) |
| tableEx, pivotTable (matriz) | `table` (as linhas da matriz viram `fields`; colunas da matriz pivotadas não são suportadas → pendência) |
| map, filledMap, shapeMap, azureMap | `map`, só se houver código IBGE (município 7 dígitos / UF 2); senão vira `table` + pendência |
| textbox | `text` com `body` = `texto` |
| slicer | não é visual: o campo entra em `filters` |
| image, shape, actionButton, pageNavigator, bookmarkNavigator | ignorar |

- Mapeamento dos papéis:
  - `Category`/`Axis`/`Rows` → `field`/`fields`;
  - `Y`/`Values` → `measures`;
  - `Series`/`Legend` → não suportado: liste no relatório.
- `span` = `span_sugerido`. Se a soma de uma "linha" visual (mesmo `y` aproximado) passar de 12, ajuste.
- Ordene os visuais da página por `y` e depois por `x`.
- Títulos: use `titulo`. Se estiver vazio, gere um título a partir da medida e do campo, por exemplo "Receita por região".
- O `id` do visual é snake_case e único, com o prefixo da página quando houver colisão.

### Páginas, filtros e sumário

- **Cada página de conteúdo vira uma `analysis`** (veja a observação sobre páginas ocultas no passo 5): `id` em snake_case do título, `title` = nome da página, `visuals` = os ids na ordem. Páginas de tooltip e de drill-through ficam de fora e vão para o relatório.
- **`summary`**: um grupo por página, ou grupos temáticos quando houver muitas páginas.
- **`filters`**: a união dos campos dos slicers de todas as páginas. A barra de filtros da DBI é global; registre isso no relatório quando um slicer só existia numa página.

## Passo 3: validar no motor real

```bash
cd web && node --import tsx scripts/pbix/validar-template.ts "$USERPROFILE/dbi-importacoes/<id>/template.json" --dados "$USERPROFILE/dbi-importacoes/<id>/dados"
```

O validador confere:

- o schema;
- as colunas do contrato contra o Parquet;
- cada medida, calculando o total geral;
- cada campo, mostrando o top 3;
- cada visual e cada filtro.

Corrija até ficar "Tudo ok". Em seguida, mostre à pessoa os totais das principais medidas para que ela confira com os cartões do Power BI, que devem bater sem filtros aplicados.

## Passo 4: relatório e entrega

Escreva `relatorio.md` na pasta de saída com:

- resumo do que foi convertido (tabelas, medidas, visuais por página);
- **aproximações**: floco de neve achatado, slicer que virou filtro global, combo que virou linha, span ajustado;
- **pendências**: medidas DAX sem tradução (com o DAX original), visuais não suportados, legendas/séries ignoradas;
- os totais conferidos no passo 3.

Por último, informe os caminhos do `template.json` e dos Parquet.

## Passo 5 (opcional): ligar a uma organização

Só faça este passo quando a pessoa pedir, e **confirme antes**: ele grava em produção (catálogo, dashboard e bucket). O script:

- grava o template como **rascunho** (fora da vitrine);
- cria o dashboard no espaço do cliente;
- sobe as tabelas pelo mesmo ingest da tela e publica.

Antes de rodar, confira o slug da organização e do cliente (`organizations.slug` e `org_clients.slug`):

```bash
cd web && node --env-file=.env.vercel-production --conditions=react-server --import tsx scripts/pbix/carregar-dashboard.ts \
  --template "<pasta>/template.json" --dados "<pasta>/dados" --org <slug-org> --cliente <slug-cliente>
```

Observação sobre páginas ocultas: relatórios com navegação por botões costumam marcar quase todas as páginas como ocultas. Por isso, considere como conteúdo toda página que tenha visuais de dados, e descarte só as de tooltip ou drill-through (página pequena e sem slicers).
