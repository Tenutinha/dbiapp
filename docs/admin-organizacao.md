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
| 1 | **Cliente / organização** | Nome, endereço (`dbi.app.br/<org>/<cliente>`) e quantos dashboards o espaço tem. Ocupa o bloco inteiro | ✎ ao lado do nome de um cliente **renomeia** ali mesmo — nome e **endereço** (`/<org>/<cliente>`), que acompanha o nome até ser editado à mão (Enter salva, Esc cancela). Dados, arquivos e links compartilhados (`/s/…`) continuam funcionando; só links salvos com o endereço antigo deixam de abrir, e a tela avisa antes de salvar. ⚙ abre o **tema daquele espaço num modal no centro da tela** (`?tema=org` ou `?tema=<cliente>`): logo, cores, área clara/escura, **fundo do dashboard** (cor livre ou sugestões; cartões, linhas e texto se ajustam e a área fica clara ou escura conforme a cor — migração 011) e pré-visualização, com abas para trocar de espaço. A página `/<org>/admin/aparencia` continua existindo para links diretos. "+ Adicionar cliente", na última linha da tabela, cadastra um cliente novo |
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

## Arquivos da organização (explorador)

Tudo o que a organização guarda no armazenamento (`orgs/<org>/…`) fica num **explorador no estilo do Windows**,
num modal com endereço próprio (`?arquivos=<pasta>`). Abre pelo botão **📁 Arquivos** no cabeçalho da coluna
"3 · Dados" ou pelo **ícone de pasta** ao lado da engrenagem de cada espaço (já na pasta do cliente,
`clientes/<cliente>`). Só a equipe que gerencia dados (admins e editores de dados) acessa.

- **Árvore à esquerda** (clientes pelo nome) e trilha clicável no topo, com ← → ↑ e busca na pasta.
- **Detalhes** (Nome, Cliente, Tipo, Tamanho, Modificado, **Usado em**) ou **ícones grandes**; colunas ordenáveis.
  "Usado em" mostra os dashboards do mesmo espaço que engataram um arquivo com esse nome (verde = publicado,
  laranja = rascunho).
- **Seleção** como no Windows (clique, Ctrl+clique, Shift+clique, Ctrl+A) e **menu do botão direito**: abrir,
  renomear (F2), mover para…, copiar caminho, excluir (Del, com confirmação).
- **Mover** arrastando itens para uma pasta da lista ou da árvore. A raiz, `clientes/` e a pasta de cada
  cliente não podem ser renomeadas, movidas nem excluídas aqui (a pasta do cliente acompanha o endereço dele).
- **Enviar**: soltar arquivos **ou pastas inteiras** em qualquer ponto da janela (a estrutura de pastas é
  recriada), ou "Enviar arquivos" / "Enviar pasta". Uma **fila no canto** mostra o progresso e a velocidade de
  cada arquivo, envia 3 por vez, permite cancelar e tentar de novo. No bucket, o navegador envia direto com URL
  assinada — por isso a origem precisa estar no **CORS do bucket** (hoje: dbi.app.br, www, localhost:3000/3014/3020).
- Nomes nunca são sobrescritos: um arquivo com nome já usado vira `nome-2.ext`.
- **Rapidez:** "Arquivos" abre no navegador, sem pedir a página de novo ao servidor. Cada pasta vista fica em cache
  (aparece na hora e se atualiza por trás), passar o mouse numa pasta já a carrega, e clientes e "Usado em" são
  buscados uma vez por organização (`action: meta`). As pastas da plataforma (`datasets`, `uploads`, `branding`)
  não aparecem nem podem ser alteradas.
- **Pasta final `dashboards/`:** cada cliente (e a própria organização) tem `dashboards/<id do dashboard>/v<n>/`
  com os Parquet que o dashboard lê. Só a versão publicada fica lá (e um rascunho em andamento): ao publicar,
  os arquivos que a versão nova não usa são apagados. Aparece no explorador **só para leitura**; renomear o
  cliente move a pasta e o banco acompanha. O resto da pasta do cliente (brutos, fiscal, preparado…) é o
  armazenamento de apoio. Os dados antigos em `orgs/<org>/datasets/` saem com `scripts/migrar-dashboards.ts`.
- **Envios sempre visíveis:** a fila fica fixa no canto da tela, acima de qualquer modal, e continua com o
  explorador fechado; sair da página com envios em andamento pede confirmação.
- **Carregando:** qualquer link que vá ao servidor mostra uma barra no topo e o cursor de espera (`NavigationProgress`).

### Inteligência nos arquivos (layout, situação e "Organizar pasta")

Cada arquivo da pasta aberta é **analisado automaticamente** (lendo só o começo dele) e o resultado fica guardado
(`storage_file_analysis`, migração 013); só é refeito quando o arquivo muda (tamanho ou data).

- **Layout**: SPED reconhecido pelo registro 0000 ("EFD Contribuições · CNPJ · 07/2026", também EFD ICMS/IPI e ECD),
  NF-e pelo XML, CSV/Parquet pelo cabeçalho ("CSV · 19 colunas"), documentos (PDF, Excel, ZIP, PBIX).
- **Situação**, conferida contra os dashboards **do espaço do arquivo** (pasta do cliente → dashboards dele):
  - **Pronto** — CSV/Parquet com todas as colunas obrigatórias de uma tabela ("Pronto para EFD › itens");
  - **Precisa de tratamento** — fiscais brutos ("Montar tabelas em …") e CSV que não batem (mostra a tabela mais
    próxima e as colunas que faltam); fiscais fora de `fiscal/<molde>/<CNPJ>/<período>` ganham "fora do padrão";
  - **Não reconhecido**, **Documento** e **Conferido no engate** (Parquet acima de 50 MB, que não é baixado só para análise).
- **Filtro** na barra: todos, prontos, precisam de tratamento, fora da pasta padrão, não reconhecidos.
- **Organizar pasta**: prévia "arquivo → destino" dos fiscais soltos da pasta e subpastas (com "substitui o existente"
  quando o mesmo documento já está arquivado); só move o que for confirmado. Usa a mesma regra do "Montar tabelas"
  (`fileFiscal` em `web/src/lib/services/fiscal.ts`). CSV, Parquet e documentos nunca são movidos.
- No **Escolher arquivo** do engate, os arquivos prontos para aquela tabela aparecem primeiro, destacados.

## Engate dos dados (dentro de "Gerenciar dados")

O modal de dados mostra **o que o dashboard precisa** (um cartão por tabela do contrato) e, ligado à tabela
fato por um fio, o **filtro dos dados**. Os arquivos ficam no explorador acima; o engate só os escolhe.

- **Escolher arquivo**: abre o explorador em modo seleção, já na pasta do espaço. Só `.parquet`, `.csv` e
  `.txt` podem ser escolhidos (os demais aparecem apagados); dá para enviar e organizar dali mesmo. O cartão
  mostra o caminho do arquivo conectado e permite **Trocar arquivo**.
- **Do computador** (ou soltar o arquivo sobre o cartão): envia direto para a tabela, sem passar pelo explorador.
- Arquivos da pasta do espaço com o nome de uma tabela aparecem como **sugestão**; "Verificar N sugestões"
  confere todas.
- **Conferência antes de engatar**: o servidor lê só as colunas do arquivo (nada é gravado) e compara
  com o contrato ("✓ 6/6 colunas batem", com aviso de colunas que serão convertidas). Divergência (coluna
  obrigatória faltando, cabeçalho duplicado…): o cartão treme e a comparação coluna a coluna abre sozinha.
- **⚡ Engatar** (ou "Engatar N prontas"): converte o arquivo para o rascunho do dashboard, com a mesma
  validação de um upload; a tomada encaixa e soltam **confetes**. Depois é só **Publicar dados**.

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

## Acesso por link (coluna Acessos)

Na última linha de cada espaço, abaixo de "Gerenciar usuários", a linha discreta **🔗 Liberar link público** libera o espaço
para **qualquer pessoa com o link**, sem conta: `dbi.app.br/l/<token>` abre a tela do espaço como um leitor
(tema, barra lateral com o sumário em hierarquia, dashboards **publicados** e filtros), sem área de dados, administração,
outros espaços nem menu do usuário.

- Clicar abre, na mesma linha, a validade (1, 7, 30 dias — padrão — ou sem expiração) e **Liberar**. Um link ativo
  por espaço: liberar de novo troca o link (o anterior para de abrir). Ligado, a linha mostra **Link público · até
  dd/mm** (endereço completo na dica), **Copiar** e **Desligar** (com confirmação).
- **Com senha** (opcional, mín. 6 caracteres): ao liberar, marque "Com senha" e digite a senha (anote para enviar —
  ela não é mostrada depois). Quem abre o link vê primeiro "Acesso protegido"; acertando, aquele navegador fica liberado
  por 12 h (cookie só daquele link, assinado). Só o hash (scrypt) é guardado; 10 erros seguidos travam o link por
  15 min. Trocar a senha = liberar um link novo (o antigo e as liberações dele param). Ligado, a linha mostra
  **Link público · com senha**. Colunas `password_hash`, `failed_attempts`, `locked_until` (migração **019**).
- Só admins da organização; a ação confere o espaço no servidor. Link revogado, expirado ou desconhecido → 404.
- Tabela `space_share_links` (migração **014**). Sem ela, a coluna avisa que a migração falta e nenhum link abre.
- Os links por dashboard (`/s/<token>`, página "Compartilhar" de cada dashboard) continuam existindo.

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
| Modal "Organizar sumário" (seções e ordem dos dashboards na barra lateral; abre por `?sumario=<org \| cliente>`, link na coluna Dashboard de cada espaço) | `web/src/components/admin/SummaryModal.tsx`, `SummaryEditorPanel.tsx` (reusa `workspace/SidebarEditor.tsx`) |
| Explorador de arquivos (árvore, detalhes/ícones, seleção, mover, fila de envio) | `web/src/components/storage/`; modal `web/src/components/admin/FilesModal.tsx` |
| Regras puras do explorador (tipo, cliente pela pasta, nomes, destinos protegidos; testadas) | `web/src/lib/storage-explorer.ts` + teste |
| API e serviço do explorador (listar, enviar, nova pasta, renomear, mover, excluir; testado) | `web/src/app/api/orgs/[org]/storage/` → `web/src/lib/services/org-storage.ts` + teste |
| Engate dos dados (cartões das tabelas, escolher arquivo no explorador, animações) | `web/src/components/data/connector/` |
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

**2026-11-10 — arquivos num explorador próprio.** Envio e armazenamento saíram do engate para o modal
"Arquivos" (estilo Windows, com fila de envio, organizar e "Usado em"); o engate ficou com as tabelas e o
filtro, escolhendo cada arquivo no explorador.
9. Migrações **010** (filtro) e **011** (fundo) aplicadas no Supabase de produção.

Próxima etapa: melhorar a **criação dos dashboards** (cadastro de modelos no catálogo).
