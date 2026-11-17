# Modelagem fiscal na máquina da DBI

A modelagem dos arquivos fiscais (ler os originais, gerar os Parquet por tabela e publicar o dashboard) é feita
**na máquina de quem opera a DBI**, pelos scripts de `web/scripts/fiscal/` ou pela tela **Converter nesta
máquina** do servidor local. O app hospedado (produção) fica só com o **envio** dos arquivos e com a visão do
andamento.

Como o arquivo vira tabela, o desenho das partes e a linhagem estão em [arquivos-fiscais.md](arquivos-fiscais.md).
O passo a passo de um cliente novo está em [fiscal-implantacao.md](fiscal-implantacao.md).

## O que fica em cada lugar

| | App hospedado (produção) | Máquina da DBI (servidor local e scripts) |
|---|---|---|
| Enviar arquivos (explorador de Arquivos) | sim | sim |
| Mapa de arquivos, linhagem, andamento da carga | sim, só leitura | sim |
| Organizar soltos, Ler, Montar tabelas, Publicar | **não** | sim |
| Converter nesta máquina (pasta local, progresso ao vivo) | **não** | sim, administrador da plataforma |

No hospedado, as rotas `fiscal/ler`, `fiscal/montar`, `fiscal/rebuild` e `fiscal/organizar` recusam o pedido, e
as telas não mostram os botões. A decisão é uma só: `fiscalModelingHere()` em `web/src/lib/services/fiscal.ts`
(falso quando a variável `VERCEL` existe).

## Os scripts

Todos rodam de dentro de `web/`. Os que falam com o banco e o bucket recebem o `.env` do ambiente de destino.

### `carregar-fiscal.ts` — a carga

Organiza os arquivos soltos, lê os originais que são novos ou mudaram (uma pasta de partes por arquivo), junta as
partes num Parquet por tabela, grava no rascunho e publica.

```bash
node --env-file=.env.vercel-production --conditions=react-server --import tsx scripts/fiscal/carregar-fiscal.ts --molde efd-contribuicoes --org <org> --cliente <cliente>
```

| Opção | Efeito |
|---|---|
| `--molde <id>` | `efd-icms-ipi`, `efd-contribuicoes`, `ecd` ou `nfe` |
| `--org <slug>` `--cliente <slug>` | o espaço do dashboard |
| `--so-molde` | só atualiza o molde no catálogo; não lê nem publica |
| `--so-blocos` | monta só as tabelas por bloco e os cadastros; a tabela principal fica como está |
| `--reler-tudo` | apaga as partes e lê todos os arquivos de novo |
| `--dimensoes-das-partes` | monta os cadastros a partir de todos os arquivos já lidos (use depois de uma carga que parou no meio) |
| `--exige-todos` | não publica se algum arquivo ficou sem ler nesta rodada (a tela usa: um mês que falhou por memória não some do dashboard) |
| `--ao-vivo [porta]` | serve o andamento num navegador desta máquina (`http://localhost:3040`; se a porta estiver ocupada, a seguinte). Liga os eventos |
| `--eventos` | imprime uma linha `@evento {...}` por arquivo lido e por tabela montada (é o que a tela usa) |

Variáveis de ambiente da carga:

| Variável | Para quê | Referência |
|---|---|---|
| `DBI_FISCAL_LOCAL_ORIGINALS` | pasta com os originais nesta máquina; o arquivo é lido do disco quando o tamanho e o MD5 são os do bucket | a pasta do cliente |
| `DBI_FISCAL_READ_CONCURRENCY` | arquivos lidos ao mesmo tempo (1 a 16) | 3 |
| `DBI_DUCKDB_MEMORY_LIMIT` | teto de memória do DuckDB | `2GB` |
| `TEMP` / `TMP` | pasta de trabalho da carga; use uma só dela quando houver outro processo do app na máquina | uma pasta fora do repositório |
| `node --max-old-space-size=<MB>` | memória do Node | 3072 |

### `montar-local.ts` — conferir sem tocar em produção

Lê arquivos `.txt` de uma pasta, gera os Parquet num diretório de saída e roda cada visual do molde. Não fala com
o banco nem com o bucket.

```bash
node --import tsx scripts/fiscal/montar-local.ts efd-icms-ipi <pasta de saída> <arquivo.txt> [...]
```

`--so-consultas` reaproveita os Parquet já gerados; `--so-blocos` monta só os blocos e os cadastros.

### `gerar-moldes.ts` e `gerar-molde-nfe.ts` — os moldes

Geram `web/fiscal-templates/*.json` a partir dos layouts em `src/lib/fiscal/`. Depois de gerar, valide
(`scripts/pbix/validar-template.ts`) e leve ao catálogo com `carregar-fiscal.ts --so-molde`.

```bash
node --import tsx scripts/fiscal/gerar-moldes.ts
```

### `auditoria/` — a Auditoria fiscal

`extrair.ts`, `preparar.py`, `molde.py`, `glossario.py` e `incluir-insumos.ts`: ver
[auditoria-fiscal.md](auditoria-fiscal.md).

## O que a carga narra (`--eventos`)

Cada linha `@evento {...}` do log é um passo. `src/lib/fiscal/local-load.ts` define os tipos (`LoadEvent`),
transforma cada um em frase (`describeEvent`) e soma o estado da rodada (`parseLoadLog`).

| Etapa | Passo | O que diz |
|---|---|---|
| quebra | `inicio` | arquivo N de M, empresa, mês, tamanho, lido do disco ou baixado do bucket |
| quebra | `lendo` | linhas lidas até agora (no máximo uma vez por segundo por arquivo) |
| quebra | `bloco` | um Parquet do arquivo gravado: tabela e linhas |
| quebra | `arquivo` (fim) | linhas por tabela, duração, ou o erro |
| uniao | `inicio` | tabela N de M e quantas partes vai unir |
| uniao | `partes` | partes reunidas (a cada 100 e no fim) |
| uniao | `juntando` | junção e ordenação (com o ano, nas tabelas divididas por ano) |
| uniao | `ano` | um ano gravado ou reaproveitado, com as linhas |
| uniao | `validando` | conferência do contrato antes de entrar no rascunho |
| uniao | `tabela` (fim) | linhas, tamanho, duração |
| publicacao | `inicio`, `fim` | a publicação e os avisos |

## A página ao vivo da própria carga (`--ao-vivo`)

Com `--ao-vivo`, a carga abre um servidor mínimo na própria máquina (só `127.0.0.1`) e imprime o endereço
(`ao vivo: http://localhost:3040`). Não depende do servidor do app, que ocupa a memória de que a carga precisa.

| Endereço | O que entrega |
|---|---|
| `/` | a página que acompanha a carga |
| `/eventos` | cada linha no instante em que é escrita (Server-Sent Events); quem conecta depois, ou reconecta, recebe primeiro o que perdeu |
| `/estado` | onde a carga está, em JSON: etapa, arquivo e tabela em andamento, contagens |

O servidor fecha quando a carga termina; a página fica com o último estado recebido.

A página (`src/lib/fiscal/live-page.ts`, um documento só, sem dependências):

- **Trilha das quatro etapas**: envio (no admin), quebra em blocos, união por bloco e publicação, com o que cada
  uma está fazendo e a barra de avanço.
- **Totais da rodada**: arquivos lidos, linhas, volume e arquivos com erro.
- **Arquivo em leitura**: empresa, mês, tamanho, de onde veio, linhas lidas subindo e os blocos já gravados.
- **Tabela em união**: partes reunidas, fase (reunindo, juntando, validando) e os anos, quando a tabela é dividida.
- **Linhas por bloco** somando a cada arquivo, e **tabelas finais prontas** com linhas, tamanho e tempo.
- **Terminal**: cada mensagem no instante em que acontece, com busca, filtro de erros e pausa da rolagem.

Para ver a tela sem rodar carga nenhuma (não fala com o banco nem com o bucket):

```bash
node --import tsx scripts/fiscal/ensaio-ao-vivo.ts
```

Com `--falha`, o ensaio mostra uma conversão que para antes de publicar; com um arquivo de log como argumento,
reproduz as linhas de uma carga real que rodou com `--eventos`.

Peças: `src/lib/fiscal/live-server.ts` e `src/lib/fiscal/live-page.ts`.

## O histórico das conversões

Toda carga que roda nesta máquina (pela tela ou pelo terminal) fica guardada, uma pasta por rodada, em
`<home>/dbi-importacoes/conversoes` (ou na pasta de `DBI_FISCAL_HISTORY_DIR`), fora do repositório:

- `saida.log`: cada linha que a carga imprimiu, a mesma que o terminal e a página ao vivo receberam;
- `resumo.json`: início, fim, duração, tempo de cada etapa, arquivos lidos e com erro (com o motivo), linhas,
  as tabelas finais e, quando parou antes de publicar, o que ela disse.

Uma carga que morre sem avisar (processo encerrado, memória da máquina esgotada) não grava o fim: ela aparece
como **interrompida**, com o que conseguiu imprimir até ali. `--sem-historico` desliga; `--so-molde` não guarda.

A página ao vivo mostra o histórico embaixo do terminal: a lista das rodadas, cada uma com a diferença de
duração para a anterior do mesmo dashboard, e as linhas de cada tabela final antes e agora. Clicar numa rodada
abre a página inteira (etapas, cartões, terminal) como ela terminou.

O servidor da carga fecha quando ela acaba. Para ver o histórico a qualquer hora:

```bash
node --import tsx scripts/fiscal/historico.ts
```

Abre em `http://localhost:3050`, na última conversão guardada. Com `--lista`, só imprime as rodadas no terminal.
O ensaio guarda a si mesmo numa pasta à parte com `--historico <pasta>` (para ver a tela sem carga de verdade).

Peça: `src/lib/fiscal/load-history.ts`.

## A tela: Converter nesta máquina

Com o app rodando na máquina (não no hospedado), o painel **Dados fiscais** mostra, em cada dashboard SPED e só
para o administrador da plataforma:

1. **Pasta dos arquivos originais** — sugerida por `DBI_FISCAL_LOCAL_ORIGINALS` ou pela última usada.
2. **Conferir pasta** — `.txt` na pasta, arquivos do dashboard no bucket, quantos têm cópia local, quantos faltam
   ler e de onde virão (disco ou bucket).
3. **Converter e publicar** — inicia `carregar-fiscal.ts --dimensoes-das-partes --eventos --exige-todos` como um processo à
   parte, com pasta de trabalho própria. Pode fechar a página: a conversão continua.
4. **Ao vivo** — arquivos lidos e barra, linhas lidas, volume, erros; **linhas por tabela**, somando a cada
   arquivo; os últimos arquivos lidos; as tabelas finais conforme ficam prontas; e a publicação.
5. **Parar** — encerra o processo. O que já foi lido fica guardado e a próxima conversão continua dali.

Só uma conversão por dashboard de cada vez. O registro da rodada e o log ficam em `<temp>/dbi-carga-local/`.

Peças: `src/lib/fiscal/local-load.ts` (lê o log em etapas, contagens e tabelas), `src/lib/services/local-load.ts`
(confere, inicia, acompanha, para), `src/app/api/instances/[id]/fiscal/carga-local` e
`src/components/fiscal-panel/LocalLoad.tsx`.

## Cuidados que já custaram caro

- **Uma carga por dashboard.** Duas rodadas no mesmo dashboard ao mesmo tempo publicam versões incompletas.
- **Memória.** A carga e o servidor de desenvolvimento disputam memória; numa máquina sem arquivo de paginação a
  carga morre sem mensagem. Antes de uma carga grande, deixe só um servidor local ligado.
- **Pasta de trabalho própria** (`TEMP`/`TMP`): dois processos no mesmo cache se atropelam.
- **Carga interrompida:** rode de novo com `--dimensoes-das-partes`; sem ela, os cadastros dos arquivos lidos na
  rodada que caiu ficam de fora.
- **Dados de cliente nunca vão para o repositório:** a pasta dos originais fica fora dele; só os Parquet prontos
  sobem para o bucket.
