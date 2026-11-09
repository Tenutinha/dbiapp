# Página de administração da organização (`/<org>/admin`)

Só **admins da organização** abrem esta página (os demais veem "Somente admins…").
Ela é pensada para ser configurada da esquerda para a direita, numa única tabela.

## A tabela de configuração — o único objeto da página

A página mostra só a tabela, sem cabeçalho. Ela se lê da esquerda para a direita como uma hierarquia:

**cliente / organização → dashboard escolhido → dados que alimentam o dashboard → quem pode acessar**

Cada **bloco** da tabela é um espaço: primeiro a organização, depois cada cliente, inclusive os que ainda
não têm dashboard. Dentro do bloco há uma linha por dashboard, e a **última linha do bloco reúne as ações**,
lado a lado: "+ Adicionar dashboard" (coluna 2), "Gerenciar dados →" (coluna 3) e "Gerenciar usuários →" (coluna 4).
A última linha da tabela, abaixo de todos os blocos, cadastra um cliente novo ("+ Adicionar cliente").

| # | Coluna | O que mostra | O que o admin faz ali |
|---|--------|--------------|-----------------------|
| 1 | **Cliente / organização** | Nome, endereço (`dbi.app.br/<org>/<cliente>`) e quantos dashboards o espaço tem. Ocupa o bloco inteiro | ⚙ ao lado do nome abre o **tema daquele espaço num modal no centro da tela** (`?tema=org` ou `?tema=<cliente>`): logo, cores, área clara/escura, **fundo do dashboard** (cor livre ou sugestões; cartões, linhas e texto se ajustam e a área fica clara ou escura conforme a cor — migração 011) e pré-visualização, com abas para trocar de espaço. A página `/<org>/admin/aparencia` continua existindo para links diretos. "+ Adicionar cliente", na última linha da tabela, cadastra um cliente novo |
| 2 | **Dashboard** | Um dashboard por linha; publicado ou não | "Ver dashboard →"; × tira o dashboard do espaço; "+ Adicionar dashboard", na última linha do bloco, abre o **seletor do catálogo** (veja abaixo) |
| 3 | **Dados** | Por dashboard, um indicador **Fatos x/y · Dimensões x/y**: quantas tabelas de cada tipo o dashboard exige (contrato do catálogo) e quantas já têm arquivo (publicado ou aguardando). Verde quando completo; abaixo, se está publicado ou com arquivos aguardando | Clicar no indicador ou em "Gerenciar dados →" (última linha do bloco) abre o **gerenciador de dados num modal no centro da tela** (`?dados=<id>`): publicar, importar do armazenamento e subir um arquivo por tabela. Se o espaço tem vários dashboards, abas no topo do modal trocam entre eles. Esc, × ou clique fora fecham; ⤢ abre em página inteira. Os arquivos que já estão na pasta da organização entram por "Importar do armazenamento", dentro do modal |
| 4 | **Acessos** | Quem vê o espaço, em uma fila de avatares (iniciais; até 6, depois "+N"), a contagem e uma linha de nomes cortada — nunca mais que duas linhas. Passe o mouse num avatar para ver nome e papel | "Gerenciar usuários →" (última linha do bloco) abre um modal com a lista completa (× tira o acesso) e o formulário para cadastrar e dar acesso a mais alguém neste espaço |

O cabeçalho da tabela só nomeia as colunas: todo o gerenciamento fica nas linhas de cada bloco.

Em Acessos de um cliente, quem aparece com "(equipe)" vê o cliente por ser admin ou editor da
organização. Por isso não tem × ali: esse acesso se tira no bloco da organização.

## Seletor de dashboards ("+ Adicionar dashboard")

Abre um diálogo grande no centro da tela com **todos os dashboards publicados do catálogo**, para escolher
o que vai para aquele espaço:

- **Busca** por nome, assunto, descrição ou título de análise. Acentos e maiúsculas são ignorados, e todas as palavras precisam aparecer.
- **Assuntos** em chips ("Todos", "Comercial", "Eleições"…) filtram a vitrine.
- **Destaque** no topo: capa grande, assunto, origem (Power BI, QlikView, feito na web) e tipos de visual
  (indicadores, mapas, barras…), descrição, números (análises, visuais, fatos, dimensões), a lista
  **"O que ele analisa"** e as tabelas que ele pede. O botão **"+ Adicionar a <espaço>"** vincula o
  dashboard; se ele já estiver no espaço, aparece "✓ Já está em <espaço>".
- **Fileiras por assunto**, com rolagem lateral: cartões com capa que crescem ao passar o mouse. Clicar
  num cartão leva ele para o destaque. Com busca ou filtro ativo, a vitrine vira uma fileira só de resultados.
- **Capas geradas**: não há imagens. Cada capa usa a cor do assunto (cores diferentes por assunto, na
  ordem alfabética) e um desenho dos visuais que o dashboard tem (barras, linha, rosca, pontos de mapa,
  um indicador grande).

Esc, × ou clique fora fecham. Depois de adicionar, o diálogo fecha e o dashboard aparece no bloco.

## Engate dos dados (dentro de "Gerenciar dados")

O modal de dados mostra um **mapa de conexões** no estilo de um diagrama de processo:

- **À esquerda, os arquivos** de uma pasta do armazenamento da organização (`.parquet`, `.csv`). Abre na
  pasta preparada com o nome do dashboard (ex.: `preparado/presidente`) ou na primeira de `preparado/`;
  o caminho e as subpastas no topo permitem navegar.
- **À direita, as tabelas** que o dashboard precisa (fatos e dimensões), cada uma com uma **tomada**.
- **Conectar**: arraste a bolinha de um arquivo até uma tabela, ou clique no arquivo e depois na tabela.
  Arquivos com o nome de uma tabela já aparecem como **sugestão** (fio tracejado cinza); "Verificar N
  sugestões" confere todas.
- **Conferência antes de engatar**: o servidor lê só as colunas do arquivo (nada é gravado) e compara
  com o contrato. Fio **verde** = tudo certo ("✓ 6/6 colunas batem", com aviso de colunas que serão
  convertidas). Fio **vermelho** = divergência (coluna obrigatória faltando, cabeçalho duplicado…): o
  cartão treme e a comparação coluna a coluna abre sozinha (✓ ok, ↻ será convertida, ✕ não encontrada,
  – opcional ausente; colunas sobrando são listadas).
- **⚡ Engatar** (ou "Engatar N prontas"): converte o arquivo para o rascunho do dashboard, com a mesma
  validação de um upload. O fio fica animado enquanto engata, a tomada encaixa e soltam **confetes** com
  "🎉 Engatado! N linhas". Depois é só **Publicar dados**.
- **Tomada = upload**: clicar na tomada de uma tabela abre o seletor de arquivos do computador e envia
  direto para ela, com a mesma animação.

## Filtro dos dados (tabela fato)

É a terceira coluna do mapa de engate, **à direita de "O que o dashboard precisa"**, ligada por um fio à
tomada direita da tabela fato (tracejado sem filtro, sólido com regras salvas). Quando a tela é estreita,
o mapa ganha rolagem horizontal. O painel **"Filtro dos dados"** define quais linhas da tabela fato o
dashboard considera — por exemplo, só `cargo` = Presidente, ou sem o `ano` 2018:

- **"+ Filtrar por uma coluna"**: escolha uma coluna da fato; aparecem os valores dela com quantas linhas
  cada um tem (os 300 mais frequentes, com busca). Marque os valores e escolha **"Manter só os marcados"**
  ou **"Excluir os marcados"**. Linhas sem valor aparecem como "(vazio)" e também podem ser escolhidas.
- Uma regra por coluna (até 10); várias regras valem juntas (E).
- A barra mostra quantas linhas ficam (ex.: 1.234 de 5.678 — 21%) e já é a prévia enquanto você edita;
  **"Salvar filtro"** grava, "Descartar mudanças" volta ao salvo.
- O filtro vale para a **tela do dashboard, os links compartilhados e as opções dos filtros da tela**
  (nenhum valor fora do filtro aparece). Os arquivos não mudam: dá para editar ou tirar o filtro a qualquer momento.

Como funciona por dentro: o filtro fica em `dashboard_instances.data_filter` (JSON, **migração 010**).
Na consulta, a tabela fato é lida por uma subconsulta filtrada com o mesmo nome
(`FROM (SELECT * FROM read_parquet(…) WHERE …) AS fato`), com os valores sempre como parâmetros. Colunas
fora do contrato da fato são descartadas na validação (`parseFactFilter`). Sem a migração aplicada, a leitura
vê "sem filtro" e salvar avisa que falta a migração.

## Como isso se liga ao banco

- Cada dashboard de um bloco é uma linha em `dashboard_instances` daquele espaço, com seus próprios arquivos e versões. O mesmo dashboard do catálogo em dois clientes são duas cópias, cada uma com seus dados.
- O × de um dashboard **arquiva** a cópia (`archived_at`): ela some da visualização, mas os dados ficam. Adicionar de novo o mesmo dashboard ao mesmo espaço traz os dados de volta.

## Regras de acesso (o que a coluna Acessos conta)

O acesso é dado **por espaço**, não por dashboard — quem entra num espaço vê todos os dashboards publicados dele:

- Espaço da organização: toda a equipe (`organization_members`: admin, editor, analista, leitor).
- Espaço de um cliente: admins e editores da organização + os usuários daquele cliente (`client_members`: analista ou leitor).
- Usuários de cliente nunca sobem dados.

As regras vivem em `web/src/lib/permissions.ts` (veja também `docs/arquitetura.md`).

## Onde está o código

| Parte | Arquivo |
|-------|---------|
| Página (carrega os dados e mostra a tabela) | `web/src/app/[org]/admin/page.tsx` |
| Agrupamento por espaço (puro, testado) | `web/src/lib/admin-setup.ts` + `admin-setup.test.ts` |
| Tabela (blocos por espaço, colunas 1–4) | `web/src/components/admin/AdminSetupTable.tsx` |
| Avatares, lista de pessoas por espaço, modal "Gerenciar usuários" e botão de revogar | `web/src/components/admin/SetupPeople.tsx`, `Avatar.tsx` |
| Seletor de dashboards (vitrine, destaque, capas) | `web/src/components/admin/catalog-picker/` (`CatalogPicker.tsx`, `PickerDetail.tsx`, `Poster.tsx`) |
| Dados do seletor e busca (puro, testado) | `web/src/lib/catalog-picker.ts` + `catalog-picker.test.ts` |
| Controles interativos (+ Adicionar cliente, Gerenciar usuários) | `web/src/components/admin/SetupTableControls.tsx` |
| Modal central genérico aberto por parâmetro na URL (fecha com ×, Esc ou clique fora) | `web/src/components/admin/RouteModal.tsx` |
| Modal de dados (abre por `?dados=<id>`) | `web/src/components/admin/DataModal.tsx` |
| Modal de tema (abre por `?tema=<org \| cliente>`) | `web/src/components/admin/ThemeModal.tsx` |
| Engate dos dados (mapa de conexões, animações, tomada de upload) | `web/src/components/data/connector/` |
| Conferência de colunas arquivo × contrato (pura, testada) | `web/src/lib/ingest/schema-check.ts` + teste |
| API do engate (listar pasta, conferir, engatar) | `web/src/app/api/instances/[id]/connector/route.ts` → `web/src/lib/services/data-connector.ts` |
| Gerenciador de dados (publicar + engate + filtro) — usado no modal e na página `/dados` | `web/src/components/data/DataManager.tsx` |
| Filtro dos dados: regra e SQL (puro, testado) | `web/src/lib/query/fact-filter.ts` + teste; aplicado em `web/src/lib/query/build.ts` |
| Filtro dos dados: painel, API e serviço | `web/src/components/data/DataFilterPanel.tsx`, `web/src/app/api/instances/[id]/data-filter/route.ts`, `web/src/lib/services/data-filter.ts` |
| Migração do campo `data_filter` | `web/db/migrations/010_instance_data_filter.sql` |
| Formulários de cliente e de acesso | `web/src/components/admin/AdminForms.tsx` |
| Ações de servidor: vincular/desvincular | `web/src/app/[org]/admin/dashboard-actions.ts` |
| Ações de servidor: clientes e acessos | `web/src/app/[org]/admin/actions.ts` |

## Histórico

**2026-11-09 — a administração virou uma tabela só.** Em uma sessão, a página saiu de várias seções soltas
(cartões por espaço, listas de clientes, usuários e arquivos) para a tabela hierárquica descrita acima,
em etapas, cada uma conferida no servidor com dados reais (porta 3020):

1. Tabela única (sem cabeçalho de página), depois reorganizada como **espaço → dashboard → dados → acessos**.
2. Ações na última linha de cada bloco ("+ Adicionar dashboard", "Gerenciar dados", "Gerenciar usuários")
   e "+ Adicionar cliente" no fim da tabela; cabeçalho só com os nomes das colunas.
3. Modais no centro da tela com endereço próprio: dados (`?dados=`), tema (`?tema=`), usuários.
4. **Seletor de dashboards** estilo vitrine (busca, assuntos, destaque com análises, capas geradas).
5. **Engate dos dados**: mapa arquivo → tabela com conferência de colunas, animação e upload pela tomada.
6. Indicador **Fatos x/y · Dimensões x/y** por dashboard; avatares na coluna de acessos.
7. **Filtro dos dados** da tabela fato, como terceira coluna do mapa de engate.
8. **Fundo do dashboard** no tema de cada espaço; botão claro/escuro da plataforma.
9. Migrações **010** (filtro) e **011** (fundo) aplicadas no Supabase de produção.

Próxima etapa: melhorar a **criação dos dashboards** (cadastro de modelos no catálogo).
