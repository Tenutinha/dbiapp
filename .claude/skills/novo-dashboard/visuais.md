# Padrões dos gráficos, seções e filtros

Um dashboard da DBI é uma página só, lida de cima para baixo, dividida em seções. O sumário lateral leva a cada seção. Estes padrões existem para que todo dashboard pareça da mesma casa.

## A página

1. **Filtros** no topo, valendo para a página inteira.
2. **Seções** (`analyses`), cada uma respondendo a uma pergunta. De três a seis é o normal.
3. Dentro da seção, do resumo para o detalhe: indicadores → evolução → composição → rankings → tabela de detalhe.

A primeira seção é sempre a **Visão geral**: quem abre o dashboard e lê só ela precisa sair com o essencial.

## Qual visual para qual pergunta

| Pergunta | Visual | Observações |
|---|---|---|
| Quanto é? | `kpi` | um número grande; uma medida por cartão |
| Como evoluiu no tempo? | `line` | campo de mês ou dia, `sort: "field"`; até 4 medidas |
| Como se compara entre períodos? | `bar` | campo de mês, `sort: "field"`; 2 medidas lado a lado |
| Quem são os maiores? | `bar` com `horizontal: true` | `sort: "measure_desc"`, `limit` de 10 a 20 |
| Como se divide? | `donut` | só com até 8 fatias; mais que isso, use barra deitada |
| Quero ver os números | `table` | campos à esquerda, medidas à direita; ordena pela primeira medida |
| Onde acontece? | `map` | só com código IBGE de município ou UF |
| Quero o dado como veio | `rows` | listagem sem soma; colunas próprias |
| Preciso explicar algo | `text` | um ou dois parágrafos; não substitui a descrição da seção |

Não use rosca para série no tempo, nem linha para categorias sem ordem. Não repita o mesmo recorte em dois visuais da mesma seção.

## Largura (`span`, grade de 12)

| Visual | Largura |
|---|---|
| Indicadores | 3 cada (4 por linha); 2, 4 ou 6 quando a linha tem outra quantidade |
| Linha ou barra de evolução | 8, ao lado de uma rosca de 4; ou 12 sozinha |
| Rosca | 4 a 6 |
| Barra de ranking | 6 (duas por linha) ou 4 ao lado de uma tabela de 8 |
| Tabela com muitas colunas, listagem | 12 |

A soma de cada linha de visuais deve dar 12.

## Indicadores

- De 4 a 8 na Visão geral. Os mais importantes primeiro.
- Um indicador de proporção (margem, carga, % realizado) junto do valor absoluto a que se refere.
- O título é o nome do indicador, sem verbo: "Faturamento", "Ticket médio", "Clientes".

## Títulos e textos

- Título de visual: "Medida por dimensão", só a primeira letra maiúscula ("Faturamento por filial", "Evolução dos clientes em compras").
- Título de seção: o assunto ("Clientes", "Apuração do ICMS").
- Rótulo de campo e de medida: curto, como aparece numa planilha ("Mês", "Filial", "Valor líquido").
- Tudo em português do Brasil, com acentos. Sem nome de cliente.
- A descrição da seção diz de onde vêm os números e qualquer ressalva que mude a leitura.

## Medidas

| `format` | Quando | Exemplo de exibição |
|---|---|---|
| `currency` | dinheiro | R$ 4,94 mi |
| `integer` | contagens | 10.011 |
| `number` | quantidades com decimais | 1.234,5 |
| `percent` | razão de 0 a 1 | 49,9% |
| `text` | medida que devolve um rótulo | LULA |

- Nome técnico (`id`) em snake_case, sem prefixo: `faturamento`, `ticket_medio`, `margem_pct`.
- Divisão sempre com `NULLIF(..., 0)`.
- Saldo que pode zerar: escreva `0 - SUM(...)` em vez de `-SUM(...)`, para não aparecer "-R$ 0".
- Medida condicional: `SUM(CASE WHEN condição THEN valor END)`.

## Campos

- Tempo: `ano` e `mes` (`'%Y-%m'`, que ordena certo como texto). Dia como `'%Y-%m-%d'`.
- Dimensão com nomes repetidos (várias filiais com a mesma razão social): junte o código, `concat(nome, ' - ', codigo)`.
- Código que precisa de legenda: `CASE col WHEN '0' THEN 'Entrada' WHEN '1' THEN 'Saída' END`.

## Filtros

- De 4 a 8. Período primeiro (ano, mês), depois os recortes mais usados, do mais amplo para o mais específico.
- Só campos que fazem sentido para a página inteira.
- Não ponha como filtro um campo com milhares de valores (a lista mostra até 500).
- Filtro de escolha única (`filterDefaults`) só quando somar vários valores não faz sentido (uma eleição, a posição de um mês).

## Identificadores dos visuais

Prefixo pelo tipo, depois o assunto, em snake_case e sem repetir:

| Tipo | Prefixo | Exemplo |
|---|---|---|
| kpi | `k_` | `k_faturamento` |
| line | `l_` | `l_faturamento_mes` |
| bar | `b_` | `b_cfop` |
| donut | `d_` | `d_situacao` |
| table | `t_` | `t_participantes` |
| map | `m_` | `m_municipios` |
| rows | `r_` | `r_c100` |

Cada visual entra em **uma** seção. Seção: `id` em snake_case, título curto.

## Sumário

`summary` agrupa as seções no menu lateral. Com até seis seções, um grupo só. Com mais, dois ou três grupos por assunto ("Painéis" e "Dados originais"; "Vendas" e "Clientes").

## Desempenho

Cada visual é uma consulta, e todas rodam a cada abertura da página.

- Até umas 40 consultas de painel é confortável. Listagens (`rows`) com `where` seletivo custam pouco.
- `limit` de tabela: 20 a 200. Listagem: 20 por padrão, com `expand` para mostrar mais quando um filtro é usado.
- Em fatos com milhões de linhas, dê `where` aos visuais para o motor ler só o trecho que interessa.
- Use `hideEmpty` em visuais opcionais, para a página não mostrar caixas vazias.

## Antes de entregar, confira

- [ ] A Visão geral responde sozinha à pergunta principal.
- [ ] Cada linha de visuais soma 12 de largura.
- [ ] Nenhuma rosca com mais de 8 fatias; nenhum ranking sem limite.
- [ ] Títulos no padrão, sem nome de cliente.
- [ ] Toda medida de proporção usa `percent` e `NULLIF`.
- [ ] Os filtros fazem sentido para todos os visuais.
- [ ] Os totais batem com a fonte.
