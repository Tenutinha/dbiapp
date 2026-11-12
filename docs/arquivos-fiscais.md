# Arquivos fiscais (SPED e NF-e): do arquivo original ao dashboard

Este documento descreve como os arquivos fiscais de um cliente viram as tabelas Parquet que os dashboards
fiscais leem: onde ficam, como são lidos, quais tabelas existem, como carregar, como cada arquivo é lido uma
única vez (montagem por arquivo), a **linhagem** de cada tabela e as próximas fases.

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
  **Montar tabelas**, que lê os arquivos novos ou trocados (seção 5) e põe as tabelas no rascunho; depois, publicar.
  O resultado diz quantos arquivos foram lidos agora e quantos já tinham sido lidos.
- Limite: pela tela, a montagem recusa ler mais de **250 MB** de arquivos de uma vez (limites da função na Vercel:
  disco e 300 s). A primeira carga de anos de EFD Contribuições (≈8 GB) ou uma ECD grande passa disso; um mês novo, não.

## 4. Carga pelo script (volumes grandes)

Em `web/`, com o `.env` de produção:

```bash
node --env-file=<.env> --conditions=react-server --import tsx scripts/fiscal/carregar-fiscal.ts \
  --molde efd-contribuicoes --org <org> --cliente <cliente> [--so-blocos | --so-molde]
```

| Opção | O que faz |
|---|---|
| (nenhuma) | atualiza o molde, lê os arquivos novos ou trocados, monta **todas** as tabelas e publica |
| `--so-blocos` | o mesmo, mas mantém `registros` como está publicada |
| `--reler-tudo` | lê de novo todos os arquivos, mesmo os já lidos |
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

## 5. Montagem por arquivo (fase 1, implementada)

Nos SPED, **cada arquivo original é lido uma única vez**. "Montar tabelas" e o script só leem os arquivos novos
ou trocados; os outros vêm do que já foi lido.

### Partes por arquivo

Cada arquivo original (empresa + período) é lido para uma pasta própria do dashboard, com uma parte Parquet por
tabela:

```
<espaço>/dashboards/<molde>-<id>/partes/<CNPJ>/<aaaa-mm>/<id do arquivo>/
    registros.parquet  bloco_a_servicos.parquet  …  participantes.parquet  …  pronto.json
```

- O **id do arquivo** é um resumo do caminho, do tamanho, da data de gravação e da versão do leitor
  (`SPED_READER_VERSION`, em `sped-kinds.ts`): muda quando o arquivo é trocado ou quando o leitor muda.
- O **`pronto.json`** (o marcador) é gravado por último e diz o que a pasta tem: a origem, a versão do leitor e,
  por tabela, a parte e o número de linhas. Pasta sem marcador é leitura interrompida.
- Código: `web/src/lib/fiscal/parts-plan.ts` (o plano, puro) e `web/src/lib/services/fiscal-parts.ts`.

| Evento | O que acontece na próxima montagem |
|---|---|
| mês novo enviado | só esse arquivo é lido |
| retificadora do mesmo mês | só o arquivo novo é lido; a pasta do antigo é apagada |
| arquivo apagado | a pasta dele é apagada e suas linhas saem das tabelas |
| molde ganha uma tabela | os arquivos são lidos de novo (o marcador não tem a tabela nova) |
| leitor muda (`SPED_READER_VERSION` sobe) | todos os arquivos são lidos de novo |
| `--reler-tudo` no script | todas as pastas são apagadas e tudo é lido de novo |

### Do que foi lido às tabelas do dashboard

Depois da leitura, cada tabela do rascunho é **montada a partir das partes** (DuckDB junta os Parquet, sem reler
os SPED) e passa pela ingestão de sempre:

- **Fatos**: as partes de todos os arquivos; a principal (`registros`) só do período mais recente de cada empresa
  quando o SPED declara `mainFactPeriods: "latest"` (EFD Contribuições). As tabelas publicadas continuam sendo um
  Parquet por tabela, então abrir o dashboard não fica mais lento com o número de meses.
- **Dimensões**: o que o dashboard já tem (rascunho, senão o publicado) mais o que os arquivos lidos agora
  trouxeram; para cada código, fica o do período mais recente. Se todos os arquivos foram lidos agora, a dimensão
  é montada só deles. Códigos de arquivos retirados podem continuar no cadastro (não atrapalha).
- Pela tela, o limite de 250 MB passa a valer só para os arquivos **a ler**: acrescentar um mês a um cliente com
  anos de histórico cabe numa requisição. A primeira carga de um histórico grande continua pelo script.

## 6. Linhagem: de onde vem cada número

A cada montagem é gravado, ao lado das tabelas do rascunho, um **`linhagem.json`**
(`<espaço>/dashboards/<molde>-<id>/v<n>/linhagem.json`), com, para cada tabela:

- **como** ela é feita, em palavras: arquivo inteiro ou blocos, registros mantidos ou deixados de fora, linhas
  somadas (por quais campos, o que se soma), e, nas dimensões, a regra do período mais recente;
- **de quais arquivos** vieram as linhas: caminho do arquivo original, empresa, período, tamanho, data de
  gravação e quantas linhas cada um pôs na tabela;
- a versão do leitor e a hora da montagem.

Além disso, **cada linha** de uma fato guarda a sua origem: `arquivo` (empresa e mês) e `linha` (a linha no
arquivo original). Nas linhas somadas (resumos do bloco C), `linha` é 0.

Código: `web/src/lib/fiscal/lineage.ts`. Ainda não há tela para a linhagem (fase 2).

## 7. Próximas fases (proposta)

### A sugestão na tela

Comparando a pasta fiscal do cliente com as partes já lidas, o sistema sabe o que falta, e pode mostrar:

- ao **vincular** um molde fiscal a um cliente que já tem arquivos reconhecidos: *"Este cliente tem 103 arquivos
  EFD Contribuições (jan/2018 a jul/2026). Criar as tabelas do dashboard?"*;
- no **gerenciador de dados** e no **explorador**, depois de um envio: *"4 arquivos novos e 1 retificado ainda não
  estão no dashboard — Atualizar"*;
- uma lista por empresa e período com o estado de cada arquivo (novo, pronto, com erro);
- a **linhagem** de cada tabela e de cada visual ("de onde vêm estes números").

### Onde roda o processamento

- **Um arquivo por requisição**, com progresso na tela ("37 de 103"); se a página fechar, os marcadores dizem
  onde parou.
- **Arquivos grandes** (ECD de 600 a 750 MB) num **processador fora da Vercel** (um job em contêiner, por exemplo
  no Google Cloud Run, que lê do bucket e grava as partes), com o mesmo código de leitura. Até lá, o script.

### Fases

1. ✅ **Partes por arquivo, marcador e linhagem**, pelo botão "Montar tabelas" e pelo script.
2. **Sugestão na tela**, estado por arquivo, progresso arquivo a arquivo e tela da linhagem.
3. **Processador fora da Vercel** para arquivos grandes e lotes longos.
4. **Atualização automática** ao enviar arquivos (opcional por espaço), sem clique.

### Pontos em aberto

- Publicar sozinho ou sempre pedir confirmação? (Sugestão: rascunho, com aviso; publicação automática como opção.)
- Erros por arquivo ficam só no resultado da montagem; guardar o histórico pede uma tabela no banco.
- O bloco C completo: com partes por mês e leitura direta do bucket, ele poderia voltar a ser publicado inteiro.
