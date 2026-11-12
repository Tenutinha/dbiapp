# Arquivos fiscais (SPED e NF-e): do arquivo original ao dashboard

Este documento descreve como os arquivos fiscais de um cliente viram as tabelas Parquet que os dashboards
fiscais leem: onde ficam, como são lidos, quais tabelas existem, como carregar hoje e, na última parte, a
**estratégia proposta** para que a criação e a atualização dessas tabelas aconteçam sozinhas a cada envio.

Moldes fiscais hoje: **EFD ICMS/IPI** (`efd-icms-ipi`), **EFD Contribuições** (`efd-contribuicoes`),
**ECD** (`ecd`) e **NF-e** (`nfe`).

---

## 1. O caminho de um arquivo

```
arquivo .txt / .xml enviado          →  pasta do cliente no bucket (solto)
"Organizar pasta" ou "Montar tabelas" →  <espaço>/fiscal/<molde>/<CNPJ>/<aaaa-mm>/<documento>.<rand>.txt
leitura (SpedReader)                  →  CSV por tabela, em disco temporário
ingestão (DuckDB)                     →  Parquet por tabela, validado contra o contrato do molde
publicação                            →  <espaço>/dashboards/<molde>-<id>/v<n>/<tabela>.<rand>.parquet
```

- **Identificação**: o registro `0000` (SPED) ou o XML (NF-e) dizem empresa (CNPJ) e período. Um arquivo do
  mesmo documento e período **substitui** o anterior (retificadora do mês; a mesma NF-e duas vezes).
- **Leitura**: `web/src/lib/fiscal/sped-kinds.ts` (o que cada SPED guarda) e `sped-stream.ts` (lê linha a linha,
  sem carregar o arquivo na memória). Os layouts dos registros estão em `web/src/lib/fiscal/layouts/*.json`.
- **Ingestão e publicação**: `web/src/lib/services/fiscal.ts` (`rebuildFiscal`) e `services/datasets.ts`.
- O molde de cada SPED é **gerado** por `web/scripts/fiscal/gerar-moldes.ts` em `web/fiscal-templates/`.
  Não edite o JSON à mão: mude o gerador e rode `node --import tsx scripts/fiscal/gerar-moldes.ts`.

## 2. As tabelas de um SPED

Toda tabela de fato de um SPED tem o mesmo formato: **uma linha por linha do arquivo**, com os campos
originais em `c01…cNN` na ordem do layout, mais o contexto (arquivo, empresa, período, número da linha,
bloco, registro, documento-pai, data, operação) e as ligações com as dimensões (participante, item, conta).

### EFD Contribuições

| Tabela | O que guarda | Tamanho com 103 meses (cliente de referência) |
|---|---|---|
| `registros` | o arquivo **inteiro** — fato principal | ~630 mil linhas **por mês**; só guarda o último mês carregado |
| `bloco_a_servicos` | bloco A (serviços) | 5 mil linhas |
| `bloco_d_transporte_comunicacao` | bloco D | 55 mil |
| `bloco_f_demais_operacoes` | bloco F | 8 mil |
| `bloco_i_…`, `bloco_p_…`, `bloco_1_…`, `bloco_9_…` | demais blocos leves | até 7 mil |
| `bloco_m_apuracao_pis_cofins` | apuração (M200, M600, M210…) | 3 mil |
| `bloco_c_resumo` | bloco C com os itens (C170) **somados** por estabelecimento, CFOP, CST e alíquota | 109 mil |
| `bloco_c_resumo_itens` | C170 somados por item | 760 mil |
| `paineis_todos_periodos` | blocos A, C (resumido), D, F e M — o que os painéis gerais leem | ~190 mil |
| `estabelecimentos`, `participantes`, `itens` | dimensões (0140, 0150, 0200) | participantes: 1,9 mi (36 MB) |

Por que tantas tabelas: o arquivo inteiro de 103 meses teria ~58 milhões de linhas (mais de 1 GB), quase tudo
bloco C, e o servidor baixa cada tabela inteira ao abrir o dashboard. As tabelas por bloco guardam todos os
períodos com poucos MB; o bloco C entra **resumido**.

Quem lê o quê: cada visual do molde diz de qual fato lê (`fact`). Sem `fact`, lê a principal (`registros`).
Uma fato com `sameAs: "registros"` tem as mesmas colunas e é lida com esse nome, então medidas e filtros
servem para todas.

### Declarar uma tabela nova

Em `sped-kinds.ts`, `blockFacts`:

```ts
bloco_x_algo: { blocks: ["X"] },                                     // um bloco inteiro
bloco_c_resumo: { blocks: ["C"], skip: ["C100", "C110"],              // registros de fora
  collapse: { record: "C170", keys: [...], sums: [...], byEstablishment: true, byItem: false } }, // somar um registro
```

O gerador cria a tabela no molde (`sameAs`, descrição e, quando há `collapse`, a agregação feita na
ingestão). Depois: gerar moldes, testes, PR, deploy e carga (seção 4).

## 3. Na tela

- **Explorador de arquivos** (📁 Arquivos): o envio dos arquivos para a pasta do cliente; mostra se cada arquivo
  é reconhecido e "Organizar pasta" o leva para `<espaço>/fiscal/<molde>/<CNPJ>/<período>/`.
- **Gerenciador de dados do dashboard** → "Arquivos fiscais": lista empresas e períodos guardados e tem o botão
  **Montar tabelas**, que relê **todos** os arquivos e põe as tabelas no rascunho; depois, publicar.
- Limite: pela tela, a montagem recusa mais de **250 MB** de arquivos brutos (limites da função na Vercel:
  disco e 300 s). Um cliente com anos de EFD Contribuições (≈8 GB) ou uma ECD grande passa disso.

## 4. Carga pelo script (volumes grandes)

Em `web/`, com o `.env` de produção:

```bash
node --env-file=<.env> --conditions=react-server --import tsx scripts/fiscal/carregar-fiscal.ts \
  --molde efd-contribuicoes --org <org> --cliente <cliente> [--so-blocos | --so-molde]
```

| Opção | O que faz |
|---|---|
| (nenhuma) | atualiza o molde, relê todos os arquivos, monta **todas** as tabelas e publica |
| `--so-blocos` | atualiza o molde e refaz só as tabelas por bloco e as dimensões; mantém `registros` |
| `--so-molde` | só atualiza o molde no catálogo (visuais, medidas, seções); não toca nos dados |

Montagem local para conferir antes de publicar: `scripts/fiscal/montar-local.ts <molde> <pasta> <arquivos…>
[--so-blocos]` monta os Parquet e roda todos os visuais.

### Regras que já custaram caro

1. **Deploy antes do molde.** O código que está no ar valida o molde do catálogo; um molde com recurso novo
   (formato, opção de tabela, tabela nova) é **recusado** pelo código antigo e o dashboard quebra.
2. **Servidores locais** que leem o catálogo de produção (ex.: porta 3020) quebram do mesmo jeito se o código
   deles for anterior ao molde. Atualize a pasta deles junto com o deploy.
3. **O sumário é da tela.** Quais análises aparecem e quais estão fora do ar é editado na tela; o script mantém
   o sumário e as análises ocultas do catálogo ao atualizar o molde.
4. **Contrato com dados.** Um molde publicado com dashboards com dados só muda pelo script se tabelas e
   relações não mudarem — exceto tabelas **novas** por bloco, que são aceitas.
5. **O bloco C inteiro não é publicado.** 41,8 milhões de linhas (806 MB) no cliente de referência: o servidor
   não consegue baixá-lo a cada abertura. Ler direto do bucket foi testado (≈2 s com filtro de mês, ≈10 s sem)
   e ainda não está implementado.

---

## 5. Estratégia proposta: tabelas criadas e atualizadas a cada envio

> Proposta, ainda não implementada.

### O que se quer

- Criar um cliente, enviar os SPEDs dele e vincular o dashboard: o sistema **sugere criar as tabelas**.
- Enviar mais meses depois: o sistema **acrescenta** os dados novos às tabelas, sem reler tudo.
- Enviar uma retificadora: o sistema **troca** só aquele mês.

### Princípio: uma parte Parquet por arquivo original

Hoje cada tabela é refeita inteira a cada montagem. A proposta é que cada **arquivo original** (empresa + período)
gere a **sua parte** de cada tabela, e que a tabela publicada seja a **lista dessas partes**:

```
<espaço>/dashboards/<molde>-<id>/partes/<CNPJ>/<aaaa-mm>/<tabela>.<rand>.parquet
```

O motor já lê uma tabela feita de várias partes (`storage-parts.ts`, usado no engate de vários arquivos por
tabela). Com isso:

| Evento | O que acontece |
|---|---|
| mês novo enviado | processa só esse arquivo e **acrescenta** as partes dele |
| retificadora do mesmo mês | processa o arquivo novo e **substitui** as partes daquele mês |
| arquivo apagado | **retira** as partes daquele mês |
| molde ganha uma tabela nova | processa os arquivos só para a tabela nova |
| leitor muda (correção) | marca as partes como desatualizadas e reprocessa |

"Concatenar" deixa de ser reescrever um Parquet grande: é acrescentar um arquivo pequeno à lista.

**Dimensões** (participantes, itens, estabelecimentos) se repetem em todo mês. Cada arquivo também gera as suas
partes de dimensão, e na publicação elas são consolidadas numa só (uma linha por chave, a do mês mais
recente vence) — operação de segundos no DuckDB.

**Manutenção**: com muitas partes pequenas, uma rotina pode juntar as de um ano inteiro numa parte só.

### Manifesto: o que já foi processado

Uma tabela no banco (ex.: `fiscal_processing`) com uma linha por arquivo original e dashboard:

| Coluna | Para quê |
|---|---|
| dashboard, molde | de quem é |
| chave do arquivo no bucket, CNPJ, período | qual arquivo |
| tamanho e hash (md5 do GCS) | saber se o arquivo mudou |
| versão do leitor e do molde | saber se as partes ficaram desatualizadas |
| partes geradas (tabela → chave, linhas) | o que entra na publicação |
| estado: `novo`, `processando`, `pronto`, `desatualizado`, `erro` (+ mensagem) | o que mostrar e o que fazer |

A análise de arquivos que já existe (`storage_file_analysis`, migração 013) reconhece o arquivo; o manifesto
registra o que foi feito com ele em cada dashboard.

### A sugestão na tela

Comparando a pasta fiscal do cliente com o manifesto, o sistema sabe o que falta, e mostra:

- ao **vincular** um molde fiscal a um cliente que já tem arquivos reconhecidos: *"Este cliente tem 103 arquivos
  EFD Contribuições (jan/2018 a jul/2026). Criar as tabelas do dashboard?"*;
- no **gerenciador de dados** e no **explorador**, depois de um envio: *"4 arquivos novos e 1 retificado ainda não
  estão no dashboard — Atualizar"*;
- uma lista por empresa e período com o estado de cada arquivo (novo, pronto, com erro).

### Onde roda o processamento

- **Um arquivo por vez.** Cada arquivo de EFD (60 a 120 MB) cabe numa requisição da Vercel; a tela dispara os
  arquivos em sequência e mostra o progresso ("37 de 103"). Se a página fechar, o manifesto diz onde parou.
- **Arquivos grandes** (ECD de 600 a 750 MB, ou mais de ~250 MB) não cabem: vão para um **processador fora da
  Vercel** (um job em contêiner, por exemplo no Google Cloud Run, que lê do bucket e grava as partes), que
  usa exatamente o mesmo código de leitura. Até ele existir, o caminho é o script da seção 4.
- **Publicação** ao fim do lote: monta a lista de partes de cada tabela, consolida as dimensões e publica uma
  versão nova (ou deixa no rascunho, conforme a preferência do espaço).

### Fases sugeridas

1. **Partes por arquivo e manifesto**, ainda disparados pelo botão "Montar tabelas" — mas só processando o que
   é novo ou mudou. Resolve o "concatenar" e deixa as recargas de minutos para segundos.
2. **Sugestão na tela** (ao vincular e após envio) e progresso arquivo a arquivo.
3. **Processador fora da Vercel** para arquivos grandes e lotes longos.
4. **Atualização automática** ao enviar arquivos (opcional por espaço), sem clique.

### Pontos em aberto

- Publicar sozinho ou sempre pedir confirmação? (Sugestão: rascunho, com aviso; publicação automática como opção.)
- Quanto tempo guardar partes de versões antigas (hoje só a versão publicada fica na pasta).
- O bloco C completo: com partes por mês e leitura direta do bucket, ele poderia voltar a ser publicado inteiro.
