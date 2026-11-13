# Autorização de guias (saúde suplementar)

Molde `autorizacao-guias`, recriado a partir do app Qlik Sense de gerenciamento de guias (pastas *Indicadores
estratégicos* e *Emissão de guias*). O molde é genérico: qualquer cooperativa que tenha a mesma extração do
gerenciador de guias (`F_GERENCIADOR_*` / `D_GERENCIADOR_*`) usa o mesmo molde, informando o próprio código.

| Arquivo | O que é |
|---|---|
| `atualizar.ts` | Fluxo pelo armazenamento da DBI: baixa a extração da pasta do cliente, roda `preparar.py`, grava as tabelas em `<origem>/preparado/` e (com `--carregar`) o painel importa essa pasta e publica |
| `preparar.py` | Lê a extração e grava as 4 tabelas do contrato em `<pasta>/dados/` |
| `template.json` | O molde (contrato, medidas, visuais e seções). **Não** fica em `web/templates/`, porque lá ele entraria publicado no catálogo de todas as organizações; ele é carregado como rascunho por `scripts/pbix/carregar-dashboard.ts` |

## Atualizar pelo armazenamento (fluxo normal)

A extração é enviada pelo "Arquivos" do admin para uma pasta do cliente (ex.: *Araguaia › provimento › guias*,
no bucket `orgs/unimed/clientes/araguaia/provimento/guias/`). Lá ela aparece como "Precisa de tratamento": não
bate com o contrato de nenhum molde até passar pela preparação. Em `web/`, com o `.env` do ambiente:

```bash
node --env-file=<.env> --conditions=react-server --import tsx scripts/saude/guias/atualizar.ts \
  --org unimed --cliente araguaia --origem provimento/guias --cooperativa 056 --sal-arquivo <arquivo .sal> --carregar
```

Na primeira vez, cria o molde (rascunho) e o painel no espaço do cliente; nas seguintes, substitui as tabelas
de `preparado/` e publica de novo. A extração baixada é só cache e a pasta de preparação é temporária: nada
fica na máquina. Precisa de `uv` (Python 3.11 + DuckDB). Os nomes sem acento que o armazenamento grava
(`D_GERENCIADOR_BENEFICIARIO.parquet`) são aceitos.

## Preparar os dados à mão

Para conferir uma extração local. Os dados ficam **fora do repositório** (ex.: `%USERPROFILE%\dbi-importacoes\autorizacao-guias\`).

```bash
GUIAS_ORIGEM=<pasta da extração> GUIAS_PASTA=<pasta de trabalho> GUIAS_COOPERATIVA=<código, ex.: 056> GUIAS_SAL=<segredo> \
  uv run -q --no-project --python 3.11 --with duckdb python -I -X utf8 web/scripts/saude/guias/preparar.py --contar
```

- `GUIAS_COOPERATIVA` separa o beneficiário **local** (da carteira da cooperativa) do de **intercâmbio**.
- `GUIAS_SAL` pseudonimiza o beneficiário (60 bits de `md5(sal + chave interna)`, como número). Use sempre o mesmo por cooperativa,
  guardado fora do repositório; trocar o sal faz as contagens de beneficiários entre cargas deixarem de bater.

### O que a preparação faz

1. Soma os serviços por guia (`D_GERENCIADOR_GUIA_SERVIÇOS`, uma linha por serviço): valor do serviço, valor a
   recuperar (`MEDIDAS_VLR_COPARTICIPAÇÃO`), quantidade de serviços e se há consulta (TUSS 10101012 ou 10101039).
2. Troca os códigos das tabelas de domínio pelos rótulos (situação, regime, natureza, canal, liberação, tipo de
   atendimento, especialidade, cooperativa de origem).
3. Converte a data de emissão (número serial, dias desde 30/12/1899) para data.
4. **Dados pessoais:** não lê nome, carteirinha, cartão SUS nem data de nascimento do beneficiário. O
   beneficiário vira um código irreversível e a idade da guia vira faixa etária.
5. Cadastros de prestador, solicitante e local: uma linha por chave (a extração repete algumas). O cadastro "não
   informado" (chave `NINF` ou cidade `NÃO INFORMADO NA GUIA`, das guias sem executante) vira
   `Não informado na guia`, que os rankings deixam de fora.
6. Prazo da auditoria (`F_GERENCIADOR_AUDITORIA`, agrupada por guia): `auditoria_concluida` quando todas as
   etapas têm data final; `auditoria_no_prazo` quando a última data final não passa da última data prevista;
   `auditoria_horas` do início ao fim. É o prazo interno da auditoria, **não** o prazo de atendimento da ANS.

## Páginas

O molde tem duas páginas lado a lado, com os filtros no topo (`filterLayout: "inline"`; o ano começa no mais
recente):

- **Indicadores estratégicos:** solicitadas (e em análise), taxa de aprovação, taxa de negativa, auditoria no
  prazo (e horas médias), valor autorizado e valor evitado (serviços das guias negadas); evolução mensal
  autorizadas × negadas, tipo de atendimento, taxa de aprovação por mês, forma de liberação, situação e
  prestadores com maior volume.
- **Emissão de guias:** guias, clientes locais e de intercâmbio, R$ autorizado e R$ a recuperar; evolução da
  emissão, caráter de atendimento e o detalhamento por situação, com total.

Os cartões com linha de apoio (`detail`), os valores escritos nas barras (`labels`) e os filtros no topo são
recursos opcionais do motor: os outros moldes continuam como estavam.

## Regras do Qlik e como ficaram

| Indicador (Qlik) | Expressão no Qlik | No molde |
|---|---|---|
| (QNT) Guias emitidas | `COUNT(DISTINCT TICKET_GUIA)` | `COUNT(*)` (uma linha por guia) |
| (QNT) Guias liberadas | `COUNT({<GUIA_STATUS_2={'LIBERADA'}>} DISTINCT TICKET_GUIA)` | igual |
| (QNT) Guias auditoria | `COUNT(DISTINCT TICKET_GUIA)`, **sem condição** (contava todas as guias) | substituído por *auditoria no prazo*: concluídas até a data prevista ÷ concluídas |
| (QNT) Beneficiários | `COUNT(DISTINCT [%CHAVE_GUIA_NNUMEUSUA])` | igual, sobre o código pseudonimizado |
| (QNT) Consultas liberadas | TUSS 10101012/10101039 e LIBERADA | igual (marca `consulta` da guia) |
| (QNT) Guias não faturadas | `GUIA_FATURADA_2 -= 'S'`, LIBERADA e `GUIA_SERVIÇO_SN = 'S'` | sem a condição `GUIA_SERVIÇO_SN`, que vem `N` em todas as guias e zerava o indicador |
| (QNT) Clientes local | `COUNT({<BENEF_UNIMED_APELIDO={'<cooperativa>'}>} DISTINCT …)` | `beneficiario_origem = 'Local'` |
| (QNT) Clientes intercâmbio | `BENEF_UNIMED_APELIDO -= {'UNIMED CUIABA'}`: com o nome da cooperativa mascarado, contava **todos** | `beneficiario_origem = 'Intercâmbio'` |
| R$ autorizado | `SUM({<GUIA_STATUS={'LIBERADA'}>} MEDIDAS_VLR_SERVIÇO)` | igual |
| R$ recuperar | `SUM({<GUIA_STATUS={'LIBERADA'}>} MEDIDAS_VLR_COPARTICIPAÇÃO)` | só as guias de **intercâmbio**: é o valor cobrado da cooperativa de origem. Nas guias locais a coluna traz a coparticipação do próprio beneficiário (R$ 43,1 mi em 2024), que o Qlik somava junto |

Ficaram de fora: a escolha de indicador e de dimensão na tela (o Qlik troca a medida de um gráfico por botões;
aqui cada indicador tem o seu cartão e cada dimensão o seu ranking), o ranking por serviço (exige o grão de
serviço, ~26 milhões de linhas) e a evolução diária.

## Conferência com o Qlik (extração de referência)

| | Qlik | Molde |
|---|---|---|
| Guias, jan a jun/2023, mês a mês | 214.160 · 211.647 · 276.352 · 231.123 · 257.102 · 228.713 | iguais (1.419.097 no total) |
| Clientes locais, jan a jul/2023 | 177.481 | 177.481 |
| Jul/2023 e R$ autorizado | 149.772 guias · R$ 229,29 mi | 218.494 guias · R$ 239,03 mi: a tela do Qlik foi gravada no meio de julho (até junho: R$ 210,53 mi) |
