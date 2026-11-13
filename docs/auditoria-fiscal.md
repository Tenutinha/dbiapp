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
| Preparar | `preparar.py` | roda as regras e grava `dados/achados.parquet`, `dados/regras.parquet` e `dados/cobertura.parquet` |
| Molde | `molde.py` | gera o `template.json` (o texto da seção Regras vem da lista de regras do preparo) |
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

Colunas de `achados`: `regra`, `fonte` (EFD Contribuições, EFD ICMS/IPI, NF-e (XML)), `competencia` (AAAA-MM),
`estabelecimento`, `chave`, `num_doc`, `operacao` (Entrada/Saída), `cod_part`, `num_item`, `cod_item`, `cfop`,
`cst_pis`, `cst_cofins`, `campo` (o campo do layout conferido), `esperado`, `encontrado`, `diferenca`
(encontrado − esperado, só quando há os dois), `arquivo`, `linha`.

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
3. `preparar.py --contar`, confira amostras no arquivo original, gere o molde (o texto da seção Regras se atualiza) e
   carregue de novo.
4. Atualize a tabela de regras deste documento.

Cuidado de desempenho: **nunca junte as notas com os itens de todos os arquivos de uma vez**. Numa tentativa, a
junção de 30 milhões de linhas encheu 28 GB de disco temporário. Regras de item ficam em `regras_do_arquivo`.

## Atualizar todo mês

Depois de atualizar os dashboards fiscais com o mês novo: `extrair.ts` (só o arquivo novo é lido), `preparar.py`,
`molde.py` (só se as regras mudaram) e `carregar-dashboard.ts`.

## Próximos passos

- Levar o preparo para o app: montar as tabelas da Auditoria pelo "Montar tabelas", a partir das partes por arquivo
  da EFD Contribuições (ver [arquivos-fiscais.md](arquivos-fiscais.md#5-montagem-por-arquivo-fase-1-implementada)).
- Regras novas descritas pelo tributário de cada organização.
- ECD: conciliação de receita contábil × fiscal, com o mapeamento das contas.
- Situação das notas nos XML (canceladas, recusadas) para limpar a O03.
