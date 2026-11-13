# Documentar os dados

Antes de desenhar qualquer gráfico, entenda e registre os dados. O dicionário é o que permite a outra pessoa (ou outro agente) manter o dashboard depois.

## 1. Examinar os arquivos

Use o DuckDB para ler os arquivos onde estão, sem carregar tudo na memória:

```bash
uv run -q --no-project --python 3.11 --with duckdb python -I meu_perfil.py
```

Guarde o script na pasta de rascunho da sessão, não junto dos dados. Para cada arquivo, levante:

- **Tamanho:** linhas e colunas.
- **Colunas:** nome, tipo lido, quantos vazios, quantos valores distintos, mínimo e máximo, três exemplos.
- **Grão:** o que é uma linha (um item de venda? um título? um saldo por conta e mês?). Confirme contando a chave candidata: `COUNT(*) - COUNT(DISTINCT (a, b))` tem de dar zero.
- **Datas:** período coberto e se há hora junto.
- **Números:** vírgula ou ponto decimal, negativos, zeros suspeitos.
- **Categorias:** as de poucos valores (situação, tipo, canal) com a contagem de cada valor.

Coisas que costumam morder:

- a mesma informação escrita de dois jeitos ("RIO BRANCO" e "RIO  BRANCO");
- códigos com zero à esquerda lidos como número;
- valor repetido em várias linhas da mesma chave (somar duplica);
- linhas de total misturadas com as de detalhe;
- chave estrangeira que não existe na dimensão.

## 2. Definir o contrato

O motor trabalha com um **esquema em estrela**:

- **Uma tabela fato:** a de grão mais fino, que alimenta as medidas.
- **Dimensões:** cadastros que descrevem a fato (cliente, produto, filial, conta). Cada uma tem uma chave única e sem vazios.
- **Relacionamentos:** da fato para a dimensão, por uma coluna de cada lado. Uma dimensão pode ligar outra já ligada antes (fato → `d_candidato` → `d_partido`), na ordem dos relacionamentos.

Regras do contrato:

| Item | Regra |
|---|---|
| Nomes de tabelas e colunas | minúsculas, números e `_`, começando por letra |
| Tipos | `integer`, `decimal`, `text`, `date`, `timestamp`, `boolean` |
| Códigos (CNPJ, CFOP, CEP, matrícula) | sempre `text`, para não perder zeros |
| `required` | `true` só se a coluna nunca vem vazia; senão `false` |
| `key` da dimensão | única e obrigatória |
| `sortBy` da fato | as colunas mais filtradas (em geral a data), até 6 |
| Colunas fora do contrato | o envio ignora, com aviso; não ponha no contrato o que nenhum campo, medida ou relacionamento usa |

Se os dados não estão nesse formato, **prepare-os** e guarde o que fez: junte tabelas, limpe grafias, crie a coluna rateada, derive a chave. Faça isso com um script na pasta de trabalho, gerando um Parquet por tabela com o nome da tabela (`vendas.parquet`, `clientes.parquet`). Quem for carregar os próximos períodos precisa conseguir repetir o preparo: descreva-o no dicionário.

Um molde pode ter mais de uma fato (cada visual escolhe a sua com `fact`; veja "Mais de uma fato" em `visuais.md`). Mas uma medida lê uma fato só: se a conta mistura as duas (realizado ÷ meta), some a segunda antes e leve-a como colunas da primeira, se o grão permitir.

## 3. Escrever o dicionário

`dicionario.md`, na pasta de trabalho, neste formato:

```markdown
# Dicionário de dados: <nome do molde>

Origem: <de onde os arquivos vêm e como são gerados>.
Período coberto: <início> a <fim>. Atualização: <mensal, diária…>.

## vendas (fato)

Uma linha por item vendido. 27.732 linhas.

| Coluna | Tipo | Obrigatória | O que é | Exemplo | Observações |
|---|---|---|---|---|---|
| data | date | sim | Data da venda | 2026-07-14 | Sem hora |
| tipo | text | sim | V = venda, D = devolução | V | 797 devoluções |
| vlrliquido | decimal | sim | Valor líquido do item | 152,30 | Negativo nas devoluções |

## clientes (dimensão, chave: cliente)

…

## Relacionamentos

- vendas.cliente → clientes.cliente (5 vendas sem cliente cadastrado)

## Preparo dos dados

1. <passo que transforma o arquivo original no arquivo do contrato>

## Pontos de atenção

- <o que o leitor precisa saber para não interpretar errado>
```

Preencha "O que é" com o significado de negócio, não repita o nome da coluna. Quando não souber o significado, pergunte ou escreva "a confirmar": um dicionário com chute é pior que um com lacuna marcada.

## 4. Descrições dentro do molde

O que vai para o `template.json` a partir do dicionário:

- `tables[].description`: o grão da tabela em uma frase ("Uma linha por item vendido (V) ou devolvido (D).").
- `columns[].description`: só nas colunas que não se explicam pelo nome.
- A descrição de cada seção (`analyses[].description`) recebe as ressalvas que mudam a leitura dos números ("Notas canceladas ficam fora dos valores.").
