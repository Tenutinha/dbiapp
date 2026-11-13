-- Clientes, com a classe calculada pelos títulos a receber de cada um.
-- Lê modalidades (montada antes) para a regra de "pode atrasar".
WITH titulos AS (
  SELECT t.chave_cliente, t.nrtitulo, t.parcela, t.vlrtitulo, t.analise_status, m.pode_atrasar
  FROM fin_titulosreceber t
  LEFT JOIN modalidades m ON m.chave_modalidade = t.chave_modalidade
),
por_cliente AS (
  SELECT
    chave_cliente,
    -- [Qnt Títulos]: títulos distintos do cliente.
    COUNT(DISTINCT nrtitulo) AS qnt_titulos,
    -- [Qnt Títulos Atrasados]: títulos distintos atrasados, só nas modalidades que podem atrasar.
    COUNT(DISTINCT nrtitulo) FILTER (WHERE analise_status = 'Atrasado' AND pode_atrasar = 'S') AS qnt_atrasados
  FROM titulos
  GROUP BY chave_cliente
),
valor AS (
  -- [Valor Título]: vlrtitulo somado uma vez por parcela (cliente, parcela, título, valor), sem repetir
  -- as várias linhas de recebimento da mesma parcela.
  SELECT chave_cliente, SUM(vlrtitulo) AS valor_titulo
  FROM (SELECT DISTINCT chave_cliente, parcela, nrtitulo, vlrtitulo FROM titulos)
  GROUP BY chave_cliente
)
SELECT
  c.chave_cliente,
  c.razaosocial,
  c.uf,
  c.cidade,
  -- cliente_classe (DAX "Cliente Classe"): todos os títulos do cliente atrasados → "Atenção" (ou
  -- "Não Teve Título" se o valor somar zero); qualquer outro caso, inclusive sem título, → "ok".
  CASE
    WHEN p.qnt_titulos > 0 AND p.qnt_atrasados = p.qnt_titulos AND v.valor_titulo = 0 THEN 'Não Teve Título'
    WHEN p.qnt_titulos > 0 AND p.qnt_atrasados = p.qnt_titulos AND v.valor_titulo > 0 THEN 'Atenção'
    ELSE 'ok'
  END AS cliente_classe
FROM fin_clientes c
LEFT JOIN por_cliente p ON p.chave_cliente = c.chave_cliente
LEFT JOIN valor v ON v.chave_cliente = c.chave_cliente
