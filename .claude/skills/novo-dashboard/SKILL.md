---
name: novo-dashboard
description: Cria um dashboard novo da DBI do pedido à publicação — entende a necessidade, documenta os dados (perfil, dicionário e contrato), monta o molde seguindo os padrões de modelagem e de gráficos, valida no motor real, cadastra no catálogo e carrega os dados. Use sempre que o usuário chamar /novo-dashboard ou pedir para criar, montar ou fazer um dashboard novo. Dashboards não são mais cadastrados pelo formulário da tela: são criados por agente com esta skill.
---

# Novo dashboard

Na DBI, quem cria dashboard é o agente. O administrador da plataforma descreve o que precisa; você entrega o dashboard no ar, com os dados documentados e um relatório do que foi feito. O formulário da tela serve só para **editar** um dashboard que já existe.

Responda sempre em pt-BR. O resultado é um **molde** do catálogo: genérico, sem nome de cliente, que qualquer organização ativa trazendo dados na mesma estrutura.

## Antes de começar

Leia nesta ordem, só o que o caso pedir:

- `dados.md` (nesta pasta): como examinar os arquivos e escrever o dicionário e o contrato.
- `visuais.md` (nesta pasta): os padrões dos gráficos, das seções e dos filtros.
- `web/src/lib/templates/schema.ts`: o formato do molde. É a fonte da verdade; se este texto divergir dele, vale o schema.
- Um molde pronto como exemplo: `web/templates/vendas-executivo/template.json` (simples) ou `web/templates/eleicoes-presidente/template.json` (seções, mapa, filtro de valor único).

Casos com caminho próprio:

| Origem | Use |
|---|---|
| Arquivo Power BI (.pbix) | a skill `pbix-importar`, que extrai modelo, medidas e páginas; volte aqui para os padrões e a publicação |
| SPED (EFD ICMS/IPI, EFD Contribuições, ECD) ou XML de NF-e | os moldes fiscais que já existem e `web/scripts/fiscal/` (não crie outro molde para o mesmo arquivo) |
| Qualquer outra fonte (planilhas, CSV, Parquet, exportação de sistema) | este fluxo inteiro |

## Passo 1: entender o pedido

Pergunte só o que não der para descobrir sozinho. Em geral bastam três coisas:

1. **Que decisões o dashboard apoia?** As perguntas que a pessoa quer responder viram as seções e os indicadores.
2. **Onde estão os dados?** Caminho dos arquivos, ou a pasta do cliente no armazenamento (`orgs/<org>/clientes/<cliente>/`).
3. **Para quem é?** Organização e espaço (cliente) onde ele fica ativo. Confira os endereços no banco (`organizations.slug`, `org_clients.slug`) em vez de adivinhar.

Se a pessoa já disse, não pergunte de novo. Se faltar um detalhe menor, decida, siga e registre a decisão no relatório.

## Passo 2: documentar os dados

Siga `dados.md`. Saem daqui, na pasta de trabalho:

- `dicionario.md`: cada tabela e cada coluna, com tipo, significado, exemplo e qualidade (vazios, duplicados, valores estranhos).
- O **contrato**: uma tabela fato, as dimensões, as chaves e os relacionamentos.
- Os arquivos de dados prontos para o contrato (Parquet ou CSV, um por tabela, com os nomes das tabelas).

A pasta de trabalho é `%USERPROFILE%\dbi-importacoes\<id-do-molde>\`, **fora do repositório**. Dados de cliente nunca são commitados.

## Passo 3: montar o molde

Escreva `template.json` na pasta de trabalho. As regras que mais dão problema:

- **Identidade genérica.** `id` (minúsculas, números e hífen), `name` e `description` descrevem a análise, nunca o cliente, a organização ou o arquivo de origem. Vale também para títulos de seções e de visuais.
- **Uma única tabela `fact`.** Relacionamentos sempre partem dela. Dimensão precisa de `key` única e sem vazios.
- **Colunas obrigatórias não podem ter vazio.** O envio recusa. Marque `"required": false` nas que podem vir vazias.
- **`sql` de campos e medidas** passa por um filtro de caracteres: sem `;`, sem `--`, sem aspas duplas, sem `|`. Para juntar textos use `concat(a, ' - ', b)`. Use `tabela.coluna` (os apelidos são os nomes das tabelas).
- **Medidas** já trazem a agregação (`SUM(...)`, `COUNT(DISTINCT ...)`). Divisão sempre com `NULLIF(denominador, 0)`. Percentual é razão de 0 a 1 com `format: "percent"`.
- **Datas** viram campos de texto ordenáveis: ano `CAST(year(t.data) AS VARCHAR)`, mês `strftime(t.data, '%Y-%m')`.
- **Foto de um momento** (estoque, saldo, carteira): ponha o campo de mês em `filters` e em `filterDefaults` com um valor que não existe nos dados (`"mais recente"`); o filtro vira escolha única e abre no maior valor.
- **A fato repete valores** (um título com várias linhas, por exemplo): gere nos dados uma coluna `<valor>_rateado` = valor ÷ número de linhas da chave, some essa coluna e explique na descrição da tabela.
- **Consulta do dado original**: o visual `rows` lista linhas sem somar, com colunas próprias (`columns: [{label, sql}]`), e aceita `where`, `orderBy`, `limit` e `expand`.

- **Dashboard interno** (documentação, auditoria da própria DBI): `"access": "platformAdmin"` no molde faz os dashboards dele existirem só para o administrador da plataforma. A equipe e os clientes da organização não o veem na barra lateral, na administração nem pelo endereço; links de compartilhamento não o abrem e ele nunca entra na vitrine.

Opções que todo visual aceita: `where` (condição só dele), `skipFilters` (filtros de tela que ele ignora) e `hideEmpty` (some da página quando não tem linhas).

Os visuais, as seções (`analyses`), o sumário (`summary`) e os filtros seguem `visuais.md`.

## Passo 4: validar no motor real

```bash
cd web && node --import tsx scripts/pbix/validar-template.ts "<pasta>/template.json" --dados "<pasta>/dados"
```

O validador confere o schema, as colunas do contrato contra os arquivos, vazios em colunas obrigatórias e roda cada medida, campo, visual e filtro. Corrija até sair "Tudo ok".

Depois **confira os números com a fonte**: escolha dois ou três totais que a pessoa conhece (o faturamento do mês, o saldo de uma conta, a quantidade de registros) e compare. Um dashboard que roda sem erro e soma errado é pior que um que não roda. Anote no relatório o que bateu e contra o quê.

## Passo 5: publicar

Isto grava em produção (catálogo, dashboard e armazenamento). **Diga o que vai acontecer e confirme com a pessoa antes**, a menos que ela já tenha pedido a publicação.

```bash
cd web && node --env-file=.env.vercel-production --conditions=react-server --import tsx scripts/pbix/carregar-dashboard.ts \
  --template "<pasta>/template.json" --org <slug-org> --cliente <slug-cliente> --dados "<pasta>/dados"
```

- Só `--template`: cadastra o molde no catálogo como rascunho, sem ligar a ninguém.
- `--org` (e `--cliente`) sem `--dados`: ativa o dashboard vazio; os dados entram depois pela tela.
- Com `--dados`: ativa, sobe as tabelas pelo mesmo caminho da tela e publica.

O molde entra como **rascunho**, fora da vitrine das outras organizações. Quem publica no catálogo é o administrador, pela bandeira de status na vitrine.

Em seguida **abra o dashboard no navegador** e confira: título e descrição, filtros, cada seção, nenhum visual com "Não foi possível calcular". Se a mudança envolveu código do app, ele precisa estar em produção antes (PR, build da Vercel e merge com o OK da pessoa).

## Passo 6: entregar

Escreva `relatorio.md` na pasta de trabalho e resuma para a pessoa:

- o link do dashboard e onde ele ficou (organização e espaço);
- o que ele mostra, seção por seção;
- os totais conferidos com a fonte;
- o que foi aproximado e o que ficou de fora, com o motivo;
- o que ela precisa fazer (publicar o molde no catálogo, mandar os dados dos próximos períodos).

## Limites do motor

Diga com clareza quando o pedido esbarra nisto, em vez de entregar algo que parece atender:

- Uma medida lê uma fato só. Um dashboard pode ter várias fatos (cada visual escolhe a sua com `fact`), mas uma conta que mistura duas (realizado ÷ meta) precisa das colunas na mesma fato: veja "Mais de uma fato" em `visuais.md`.
- Sem comparação com o período anterior, acumulado no ano nem percentual do total geral (não há inteligência de tempo nem cálculo que ignore os filtros).
- Filtro de tela vale para a página toda; cada visual pode ignorar filtros (`skipFilters`) ou ter condição própria (`where`). Clicar num item de gráfico ou tabela filtra os outros visuais (filtro cruzado, guardado no endereço), mas não há seleção que mude a medida de um visual.
- Mapa só por município ou UF, com código IBGE.
- Layout em grade de 12 colunas; não há posição livre.

Se o pedido depende de algo assim, proponha a alternativa mais próxima e registre a pendência no relatório. Se valer evoluir o motor, sugira como tarefa separada.

## Trabalho no repositório

- Outras sessões usam a mesma pasta. Para mexer em código, trabalhe num worktree e numa branch próprios, faça `git add` por caminho e nunca commite `web/tsconfig.json` nem `.claude/launch.json`.
- O `next build` local costuma faltar memória: rode `tsc --noEmit`, `eslint` e `vitest --maxWorkers=1`, e use o build da Vercel no PR.
- Merge e exclusão de branch pedem o OK da pessoa.
