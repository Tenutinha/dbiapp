# Auditoria fiscal

O dashboard **Auditoria fiscal** (molde `auditoria-fiscal`) aplica regras de auditoria sobre os arquivos fiscais que
um espaço já tem: cada nota e cada item da EFD Contribuições contra ela mesma, a mesma nota na EFD ICMS/IPI e nos XML
de NF-e, e situações que podem ser crédito não aproveitado ou tributo pago a maior.

Ele não lê nada do cliente de novo: usa os arquivos já guardados e os dashboards fiscais já publicados. Para a
implantação completa num cliente, veja [fiscal-implantacao.md](fiscal-implantacao.md).

---

## Como funciona

```
EFD Contribuições (brutos no bucket) ──┐
EFD ICMS/IPI (dashboard publicado) ────┼─ extrair.ts ─→ entrada/ ─ preparar.py ─→ dados/ ─┐
NF-e (dashboard publicado) ────────────┘                                                    ├─ carregar-dashboard.ts ─→ dashboard
                                                   molde.py ─→ template.json ───────────────┘
```

| Etapa | Script (em `web/scripts/fiscal/auditoria/`) | O que faz |
|---|---|---|
| Extrair | `extrair.ts` | baixa os SPED de EFD Contribuições do espaço, um a um, e guarda só C010, C100 e C170 de cada um, linha a linha (`entrada/contrib_c/<cnpj>-<mês>-<n>.parquet`); copia a fato `registros` publicada da EFD ICMS/IPI e a `nfe_itens` da NF-e. Arquivo já extraído não é lido de novo. |
| Preparar | `preparar.py` | roda as regras e grava `dados/achados.parquet`, `dados/regras.parquet`, `dados/cobertura.parquet` e `dados/glossario.parquet` |
| Glossário | `glossario.py` | lê o [catálogo](auditorias-catalogo.md) e as regras do preparo e grava só `dados/glossario.parquet` (o preparo já faz isso; rodar sozinho serve para atualizar o glossário sem refazer as regras) |
| Molde | `molde.py` | gera o `template.json` (o texto da seção Regras vem da lista de regras do preparo; os temas do Glossário, do catálogo) |
| Carregar | `scripts/pbix/carregar-dashboard.ts` | cadastra o molde no catálogo (como rascunho), ativa o dashboard no espaço, sobe as tabelas e publica |

A pasta de trabalho fica **fora do repositório** (dados de cliente nunca são commitados), por exemplo
`%USERPROFILE%\dbi-importacoes\auditoria-<org>-<cliente>\`.

Por que fora do app (por enquanto): a EFD Contribuições inteira tem dezenas de milhões de itens, e os dashboards
fiscais só publicam o bloco C resumido. A auditoria precisa de cada item, então lê os brutos. Levar isso para o
"Montar tabelas" (sobre as partes por arquivo) é o próximo passo (ver [Próximos passos](#próximos-passos)).

## As tabelas

| Tabela | Tipo | Uma linha por | Observações |
|---|---|---|---|
| `achados` | fato | regra não cumprida por uma nota (regras de nota) ou um item (regras de item) | campos de item vazios nas regras de nota; `arquivo` e `linha` levam ao registro no arquivo original |
| `cobertura` | fato extra | arquivo fiscal e mês | notas e valor de cada fonte; mostra onde cada cruzamento vale |
| `regras` | dimensão (`regra`) | regra | grupo, título, gravidade, o que confere e o que fazer |
| `glossario` | fato extra | auditoria (as 18 regras ativas e as do catálogo) | tema, situação (Ativa ou Planejada), o que confere, por que importa, dificuldade, tributarista e resultado |

Colunas de `achados`: `regra`, `fonte` (EFD Contribuições, EFD ICMS/IPI, NF-e (XML)), `competencia` (AAAA-MM),
`estabelecimento`, `chave`, `num_doc`, `operacao` (Entrada/Saída), `cod_part`, `num_item`, `cod_item`, `cfop`,
`cst_pis`, `cst_cofins`, `campo` (o campo do layout conferido), `esperado`, `encontrado`, `diferenca`
(encontrado − esperado, só quando há os dois), `arquivo`, `linha`.

## O glossário

A primeira seção da tela é o **Glossário**: todas as auditorias numa listagem só, com a situação de cada uma. Cada
tema do catálogo é um tópico (uma linha de título com a contagem) e as suas auditorias vêm logo abaixo.

- **Ativa**: já roda. São as regras C, X e O (os achados estão nas seções seguintes) e a inclusão de insumos (CR17),
  que gera o arquivo corrigido por script.
- **Planejada**: está no [catálogo](auditorias-catalogo.md) e ainda não foi implementada.

De onde vem: `glossario.py` lê os títulos `#### XX00 · Nome` e os tópicos "Confere", "Por que importa" e
"Dificuldade · Tributarista · Resultado" de `docs/auditorias-catalogo.md`, e junta as regras da lista `REGRAS` do
preparo, cada uma no tema do catálogo em que se encaixa. Em cada tema as ativas vêm primeiro. O texto do glossário é o
do catálogo: para mudar o que a tela diz, mude o catálogo e gere de novo.

```bash
uv run -q --no-project --python 3.11 --with duckdb python -I scripts/fiscal/auditoria/glossario.py --conferir
```

mostra a contagem por tema sem gravar nada. Se um item do catálogo estiver sem um dos tópicos, o script para e diz qual.

Quando uma auditoria do catálogo for implementada:

- como regra do dashboard (C, X ou O): ela entra em `REGRAS` e aparece como Ativa; tire o item do catálogo ou deixe-o
  como está (ele continua aparecendo como Planejada, com o código do catálogo), conforme a regra cubra tudo ou só parte;
- fora da tela (por script, como a CR17): acrescente o código a `ATIVAS_DO_CATALOGO`, em `glossario.py`.

A seção não segue os filtros da página. A listagem usa duas opções do visual `rows`: `wrap` nas colunas de texto (o
texto quebra em linhas em vez de ser cortado) e `groupBy` (o tópico de cada linha: onde ele muda, a tela abre uma
linha de título). O código com essas opções tem de estar **no ar antes** de o molde ser carregado. Ao classificar por
uma coluna, os títulos dos tópicos somem, porque a ordem deixa de ser a dos temas.

## As regras

Notas "regulares" = modelo 55 ou 65 com situação 00, 01, 06, 07 ou 08. Tolerâncias: R$ 0,05 em somas e cruzamentos
de valor, R$ 0,02 em base × alíquota.

### Consistência interna (EFD Contribuições contra ela mesma)

| Código | Regra | Gravidade |
|---|---|---|
| C01 | PIS do C100 ≠ soma do PIS dos itens (C170) | Alta |
| C02 | COFINS do C100 ≠ soma da COFINS dos itens | Alta |
| C03 | VL_MERC do C100 ≠ soma do VL_ITEM dos itens | Média |
| C04 | VL_PIS do item ≠ VL_BC_PIS × ALIQ_PIS ÷ 100 (itens por quantidade ficam fora) | Alta |
| C05 | VL_COFINS do item ≠ VL_BC_COFINS × ALIQ_COFINS ÷ 100 | Alta |
| C06 | CST do PIS ≠ CST da COFINS no item | Média |
| C07 | CST de saída (01–49) numa entrada, ou de entrada (50–99) numa saída | Alta |
| C08 | CFOP de saída (5, 6, 7) numa entrada, ou de entrada (1, 2, 3) numa saída | Média |
| C09 | CST tributado (01–03, 50–56) com PIS zerado | Média |
| C10 | CST sem tributação ou sem crédito (04, 06–09, 70–75) com PIS informado | Alta |
| C11 | Chave de acesso sem 44 dígitos ou com dígito verificador errado | Média |
| C12 | A mesma chave em mais de um C100 regular | Alta |

### Cruzamento entre arquivos

| Código | Regra | Gravidade |
|---|---|---|
| X01 | Nota da EFD Contribuições fora da EFD ICMS/IPI do mesmo estabelecimento e mês (só onde há EFD ICMS/IPI) | Média |
| X02 | VL_DOC diferente entre EFD ICMS/IPI e EFD Contribuições | Média |
| X03 | Nota emitida pela empresa: PIS somado dos itens do XML ≠ VL_PIS do C100 | Alta |

### Oportunidades a validar

| Código | Regra |
|---|---|
| O01 | XML de saída da empresa com NCM monofásico, CST 01 e PIS destacado (na revenda, a alíquota é zero) |
| O02 | Entrada regular na EFD ICMS/IPI sem C100 na EFD Contribuições (possível crédito não aproveitado) |
| O03 | XML de compra (terceiro → empresa, CFOP de venda) sem C100 na EFD Contribuições |

### Por que estas e não outras

- **Saídas fora da EFD Contribuições não são achado.** Notas sem efeito em PIS/COFINS (transferências, remessas)
  podem ficar fora do C100. Por isso também as entradas que faltam são "oportunidade a validar", não erro.
- **A empresa é reconhecida pela raiz do CNPJ** (8 primeiros dígitos) da EFD Contribuições: é assim que o
  preparo separa saída própria de compra de terceiro nos XML.
- **XML não trazem a situação da nota**: uma nota cancelada ou recusada aparece em O03.
- **ECD ainda não entra**: conciliar receita contábil com fiscal pede o mapeamento das contas por cliente.

## Implantar num espaço

Pré-requisitos: os dashboards EFD Contribuições (arquivos guardados no espaço) e, se houver, EFD ICMS/IPI e NF-e
**publicados** no mesmo espaço. Sem EFD ICMS/IPI ou sem NF-e o preparo roda e avisa: as regras que cruzam com eles
ficam sem achados.

Ferramentas: Node (como o resto de `web/`) e [uv](https://docs.astral.sh/uv/) para o Python com DuckDB.

```bash
# em web/, com o .env de produção; PASTA = pasta de trabalho fora do repositório
node --env-file=.env.vercel-production --conditions=react-server --import tsx scripts/fiscal/auditoria/extrair.ts \
  --org <org> --cliente <cliente> --saida "$PASTA/entrada"
```

```bash
AUDITORIA_PASTA="$PASTA" uv run -q --no-project --python 3.11 --with duckdb python -I scripts/fiscal/auditoria/preparar.py
```

```bash
AUDITORIA_PASTA="$PASTA" uv run -q --no-project --python 3.11 --with duckdb python -I scripts/fiscal/auditoria/molde.py
```

```bash
node --import tsx scripts/pbix/validar-template.ts "$PASTA/template.json" --dados "$PASTA/dados"
```

```bash
node --env-file=.env.vercel-production --conditions=react-server --import tsx scripts/pbix/carregar-dashboard.ts \
  --template "$PASTA/template.json" --org <org> --cliente <cliente> --dados "$PASTA/dados"
```

Notas:

- `extrair.ts --desde <aaaa-mm>` extrai só os meses a partir dele: bom para um primeiro teste com um mês.
- `preparar.py --contar` só mostra quantos achados cada regra dá, sem gravar `dados/`. Use antes de publicar.
- O validador tem de terminar em "Tudo ok": roda cada campo, medida, visual e filtro no motor real.
- Na primeira carga, o molde entra no catálogo como **rascunho**: só o espaço onde foi ativado o vê. Para as outras
  organizações, publique o molde pela bandeira de status na vitrine.

Tempo de referência (103 meses, 12,7 milhões de notas, 17 milhões de itens): extração ~25 min, preparo ~5 min,
carga 1 min.

### Conferir

1. `preparar.py --contar` e olhe as regras com muitos achados: dezenas de milhares numa regra de consistência
   costumam ser uma regra que não se aplica ao cliente, não erros.
2. Pegue **um achado de cada regra** na listagem do dashboard e abra o arquivo original na `linha` indicada
   (o nome do arquivo está em `arquivo`). Confira que o problema está lá.
3. Os totais da Visão geral batem com `SELECT regra, count(*) FROM 'dados/achados.parquet' GROUP BY 1`.
4. Abra todas as seções: nenhum "Não foi possível calcular".

## Acrescentar uma regra

1. Em `preparar.py`, acrescente a regra à lista `REGRAS`: código, grupo (Consistência interna, Cruzamento entre
   arquivos ou Oportunidade a validar), título, gravidade, o que confere e o que fazer. O código começa pela letra
   do grupo (C, X ou O): as seções do dashboard filtram por ela.
2. Escreva a consulta:
   - regra de **nota ou item da EFD Contribuições**: em `regras_do_arquivo`, que roda arquivo a arquivo sobre
     `nf` (notas) e `itf` (itens, com `linha_nota`);
   - regra que **cruza arquivos** ou olha todos os períodos: em `cruzar` (tabelas `notas`, `regulares`, `icms`,
     `xml`, `nfe`) ou depois do laço de `montar` (como a C12).

   A consulta devolve as colunas na ordem de `achados` (veja as regras existentes).
3. `preparar.py --contar`, confira amostras no arquivo original, gere o molde (o texto da seção Regras e o Glossário
   se atualizam) e carregue de novo.
4. Atualize a tabela de regras deste documento.

Cuidado de desempenho: **nunca junte as notas com os itens de todos os arquivos de uma vez**. Numa tentativa, a
junção de 30 milhões de linhas encheu 28 GB de disco temporário. Regras de item ficam em `regras_do_arquivo`.

## Inclusão de insumos: o arquivo corrigido da EFD Contribuições

A regra O02 acha as entradas que estão na EFD ICMS/IPI e em nenhum C100 da EFD Contribuições. O gerador
`incluir-insumos.ts` leva essas notas para o arquivo da Contribuições do mês, para validar no PVA e transmitir como
retificadora (item CR17 do catálogo de auditorias). A lógica fica em `web/src/lib/fiscal/inclusao-insumos.ts`, com
testes sobre arquivos sintéticos em `inclusao-insumos.test.ts`.

> O arquivo gerado **ainda não foi validado no PVA** com dados reais. Trate a primeira geração de cada cliente como
> teste: importe, valide, gere a apuração e confira antes de transmitir.

### O que entra

- Notas de **entrada** (`IND_OPER` 0), modelo 55, situação 00, 01, 06, 07 ou 08, cuja chave não está em nenhum C100
  da EFD Contribuições, de nenhum mês.
- Só notas com pelo menos um item de **CFOP que gera crédito**, pela tabela "CFOP – Operações Geradoras de
  Créditos" do SPED (decisão do responsável pela análise, 16/11/2026). A lista está em
  `web/src/lib/fiscal/tabelas/cfop-geradores-credito.json` e foi **transcrita da planilha de parâmetros da análise
  original** (os grupos que lá trazem o código de base de crédito da tabela do SPED); **não foi conferida contra a
  planilha oficial** (versão 1.10, de 13.03.2020), porque em 16/11/2026 o endereço antigo do portal redirecionava e
  o novo pedia autenticação. Entram também onze CFOP de devolução de venda que a planilha de parâmetros marca com
  crédito, sem código da tabela (1212, 1553, 2203, 2204, 2212, 2553, 3201, 3202, 3211, 3212, 3553), por decisão do
  responsável (16/11/2026); como o PVA só leva ao M105/M505 os CFOP da tabela oficial, confira a apuração dessas
  notas. Para usar outra lista, `--cfop <arquivo>` (um CFOP por linha).
- **A nota entra inteira**: tendo um item de CFOP que gera crédito, vão todos os C170, inclusive os de CFOP sem
  crédito (decisão do responsável, 16/11/2026; é também o que o Guia Prático pede no registro C170). Assim os totais
  do C100 continuam batendo com a soma dos itens.
- O C100 é copiado como está (os 28 campos são os mesmos nos dois layouts); o C170, sem o último campo
  (`VL_ABAT_NT`). CST, base, alíquota e valor de PIS/COFINS vão **como estão** na EFD ICMS/IPI: nada é recalculado
  nem trocado por CFOP. Os outros filhos da nota na EFD ICMS/IPI (C110, C190, C195 …) não são copiados.
- Cadastros que a nota usa e que faltam no 0140 do estabelecimento naquele arquivo: 0150 (participante), 0200 (item,
  sem o `CEST`), 0190 (unidade do item e unidade de inventário do 0200) e 0400 (natureza). O 0450 não é incluído
  porque só o C110 o usa, e o C110 não é copiado.
- Estabelecimento sem 0140 ou sem C010 no mês: são criados (o 0140 com nome, UF, IE, município, IM e Suframa do 0000
  da EFD ICMS/IPI; o C010 com `IND_ESCRI` 2). Um bloco C sem movimento (`C001` com 1) passa a 0.

### O que fica de fora (e aparece no relatório)

| Motivo | Quando |
|---|---|
| modelo, situação, sem chave | nota que não é NF-e regular |
| já escriturada | a chave está no próprio arquivo, na lista de chaves dos outros meses ou repetida na EFD ICMS/IPI |
| sem C170 | nota sem itens na EFD ICMS/IPI (em regra, emissão própria) |
| CFOP sem crédito | nenhum item da nota tem CFOP da tabela |
| conflito de cadastro | o `COD_PART` ou o `COD_ITEM` já existe no 0140 com outro CNPJ/CPF, ou com outra descrição ou NCM: a nota não entra e o conflito é listado com as duas versões, para decisão |
| cadastro ausente | a nota usa um código que não está na EFD ICMS/IPI nem no 0140 |

Unidade (0190) e natureza (0400) que já existem no 0140 com outra descrição não são conflito: vale a que o arquivo tem.

### Como o arquivo é montado

- Tudo o que não muda sai **byte a byte** como no original (ISO-8859-1 e o mesmo fim de linha).
- Os cadastros novos entram no 0140 do estabelecimento na ordem 0150, 0190, 0200, 0400; as notas novas, no C010,
  depois das notas (C100 e filhos) que já existem e antes dos outros documentos (C180, C190, C380, C400 …).
- São recontados 0990, C990, o 9900 de cada registro, 9990 e 9999. Se os encerramentos do **original** já não
  batiam com a recontagem, o relatório avisa.
- Com `--recibo <número>`, o 0000 sai como retificador (`TIPO_ESCRIT` 1 e `NUM_REC_ANTERIOR`). Sem ele, o 0000 fica
  como está e o relatório lembra de marcar no PVA.
- O **bloco M não é alterado**: a inclusão muda M100/M105, M200, M500/M505 e M600, e a apuração tem de ser refeita
  no PVA depois de importar o arquivo.
- O que vier depois do 9999 (assinatura) não é copiado: o arquivo é assinado de novo no PVA.

### Rodar

Entradas, todas em arquivos locais, **fora do repositório**:

1. o arquivo original da EFD Contribuições do mês e os da EFD ICMS/IPI de cada estabelecimento no mesmo mês
   (estão na pasta fiscal do espaço no bucket, em `<tipo>/<cnpj>/<aaaa-mm>/`); o gerador recusa arquivo de outro mês,
   de outra empresa ou dois arquivos do mesmo estabelecimento;
2. a lista das chaves já escrituradas na EFD Contribuições, de todos os meses, uma por linha. Sai da extração da
   Auditoria (`entrada/contrib_c`):

```bash
uv run -q --no-project --python 3.11 --with duckdb python -I -c "import duckdb; duckdb.sql(\"COPY (SELECT DISTINCT c08 FROM read_parquet('$PASTA/entrada/contrib_c/*.parquet') WHERE registro = 'C100' AND c08 <> '') TO '$PASTA/chaves-contrib.txt' (HEADER false)\")"
```

```bash
# em web/; não precisa de .env
node --import tsx scripts/fiscal/auditoria/incluir-insumos.ts \
  --contrib "$PASTA/originais/<contribuicoes do mês>.txt" \
  --icms "$PASTA/originais/<icms da matriz>.txt" --icms "$PASTA/originais/<icms da filial>.txt" \
  --chaves "$PASTA/chaves-contrib.txt" --saida "$PASTA/inclusao" \
  [--cfop <lista.txt>] [--recibo <recibo da escrituração a retificar>]
```

Saem em `--saida` (que o gerador recusa se estiver dentro do repositório): `<nome>-corrigido.txt` e
`<nome>-inclusao-insumos.csv`.

### O relatório

Uma linha por fato, com `tipo`, `motivo`, estabelecimento, registro, código, chave, número, participante, item,
CFOP, CST do PIS, valor, `vl_pis`, `vl_cofins`, `detalhe` e o arquivo e a linha da EFD ICMS/IPI:

| `tipo` | Uma linha por |
|---|---|
| nota incluída com crédito | nota com pelo menos um item com CST do PIS de crédito (50 a 66) e CFOP da tabela; `vl_pis` e `vl_cofins` somam esses itens |
| nota incluída sem crédito | nota incluída em que nenhum item tem CST de crédito: entra na escrituração e não muda a apuração. É a lista para o tributarista |
| nota deixada de fora | nota que não entrou, com o motivo |
| cadastro incluído | 0140, 0150, 0190, 0200, 0400 ou C010 criado |
| conflito de cadastro | código que já existe com outro conteúdo (as duas versões no `detalhe`) |
| aviso | bloco M, retificadora, assinatura, encerramentos do original, C010 com notas consolidadas, itens com `COD_CTA` fora do 0500, tabela de CFOP usada |

### Conferido no Guia Prático e a confirmar

O portal do SPED não abriu o Guia Prático em 16/11/2026; o que segue foi conferido numa transcrição do guia
(vriconsulting.com.br), sem número de versão, e nos layouts do repositório.

| Ponto | Situação |
|---|---|
| 0150, 0190, 0200, 0400 e 0450 são nível 3 (filhos do 0140); C100 é filho do C010 e C170 do C100 | conferido na transcrição (o catálogo dizia que 0190, 0400 e 0450 eram do arquivo: o gerador os trata por 0140) |
| C170 da Contribuições com 37 campos contando o `REG`, terminando em `COD_CTA`; 0200 sem `CEST` | conferido na transcrição e no layout |
| `0000.TIPO_ESCRIT` 1 = retificadora; `NUM_REC_ANTERIOR` com até 41 caracteres | conferido na transcrição; o formato exato do recibo, **a confirmar** |
| `C010.IND_ESCRI`: 1 = consolidado (C180/C190), 2 = individualizado (C100/C170) | conferido na transcrição; o que fazer quando o estabelecimento já usa C180/C190, **a confirmar** (o gerador mantém o valor e avisa) |
| Ordem dos filhos dentro do 0140 e do C010 | **a confirmar no PVA**: o gerador segue a ordem da tabela de registros do guia |
| 0990, C990 e 9990 contam a abertura e a si mesmos; 9990 conta o 9999; uma linha 9900 por registro, inclusive 9900, 9990 e 9999 | **a confirmar no PVA** (o gerador avisa quando o original não segue essa conta) |
| `C170.COD_CTA` copiado da EFD ICMS/IPI: se o PVA exige a conta no 0500 da Contribuições | **a confirmar** (o relatório avisa quantos itens entraram com conta que não está no 0500) |
| Nome da função do PVA que refaz o bloco M | **a confirmar** |

## Atualizar todo mês

Depois de atualizar os dashboards fiscais com o mês novo: `extrair.ts` (só o arquivo novo é lido), `preparar.py`,
`molde.py` (só se as regras ou o catálogo mudaram) e `carregar-dashboard.ts`.

## Próximos passos

- Levar o preparo para o app: montar as tabelas da Auditoria pelo "Montar tabelas", a partir das partes por arquivo
  da EFD Contribuições (ver [arquivos-fiscais.md](arquivos-fiscais.md#5-montagem-por-arquivo-fase-1-implementada)).
- Regras novas: o levantamento de tudo o que dá para auditar com esses arquivos, com dados, dificuldade e ordem
  proposta, está em [auditorias-catalogo.md](auditorias-catalogo.md).
- Regras novas descritas pelo tributário de cada organização.
- ECD: conciliação de receita contábil × fiscal, com o mapeamento das contas.
- Situação das notas nos XML (canceladas, recusadas) para limpar a O03.
