-- Movimento: uma linha por filial, item e mês, juntando a foto do estoque no fim do mês, as compras do mês
-- e as vendas do mês. Meses sem uma das três origens ficam com zero nela.
WITH custo_entrada AS (
  -- "ÚltimoValorUnitarioEntrada" (DAX): custo unitário da última entrada do item com custo, em qualquer
  -- filial e tipo de entrada. No mesmo dia, o maior. Custo unitário = custo da nota ÷ quantidade, com as
  -- 4 casas do decimal fixo do Power BI.
  SELECT item, MAX(ROUND(custoultimaentrada / NULLIF(qtde, 0), 4)) AS custo_unitario
  FROM (
    SELECT item, qtde, custoultimaentrada
    FROM est_entradas
    WHERE custoultimaentrada > 0
    QUALIFY dataentrada = MAX(dataentrada) OVER (PARTITION BY item)
  ) ultima
  GROUP BY item
),
foto AS (
  -- A última posição de cada mês (a foto do fim do mês), até o mês da data de referência.
  SELECT *, strftime(dataposicaoestoque, '%Y-%m') AS mes
  FROM est_estoque
  WHERE dataposicaoestoque IS NOT NULL
    AND strftime(dataposicaoestoque, '%Y-%m') <= strftime(getvariable('data_referencia'), '%Y-%m')
  QUALIFY dataposicaoestoque = MAX(dataposicaoestoque) OVER (PARTITION BY strftime(dataposicaoestoque, '%Y-%m'))
),
estoque AS (
  SELECT
    f.filial,
    f.item,
    f.mes,
    SUM(f.qtde_fisico) AS estoque_qtde,
    -- Estoque a custo da última entrada e a preço de venda: só saldo positivo entra no valor.
    SUM(CASE WHEN f.qtde_fisico > 0 THEN c.custo_unitario * f.qtde_fisico END) AS estoque_valor,
    SUM(CASE WHEN f.qtde_fisico > 0 THEN f.precovenda * f.qtde_fisico END) AS estoque_valor_venda
  FROM foto f
  LEFT JOIN custo_entrada c USING (item)
  GROUP BY ALL
),
entrada AS (
  -- Compras do mês: só entradas do tipo E (fora devolução e transferência).
  SELECT
    filial,
    item,
    strftime(dataentrada, '%Y-%m') AS mes,
    SUM(qtde) AS entrada_qtde,
    SUM(custoultimaentrada) AS entrada_valor
  FROM est_entradas
  WHERE tipoentrada = 'E' AND dataentrada IS NOT NULL
  GROUP BY ALL
),
venda AS (
  -- Vendas (V) e devoluções (D, quantidade negativa) do mês.
  SELECT
    filial,
    item,
    strftime(data, '%Y-%m') AS mes,
    -- Quantidade vendida líquida de devolução: a D já vem negativa e abate a V.
    -- (Até a carga de 09/11/2026 a devolução somava; corrigido em 13/11/2026.)
    SUM(CASE WHEN tipo IN ('V', 'D') THEN qtde END) AS venda_qtde,
    -- Faturamento líquido: a devolução vem com valor negativo e abate.
    SUM(vlrliquido) AS venda_valor,
    -- Custo das vendas: só das vendas (V).
    SUM(CASE WHEN tipo = 'V' THEN vlrcue END) AS venda_custo,
    SUM(CASE WHEN tipo = 'V' THEN qtde END) AS saida_qtde,
    -- Devolução em quantidade positiva.
    SUM(CASE WHEN tipo = 'D' THEN -qtde END) AS devolucao_qtde,
    -- Dias do mês com alguma venda (V) do item na filial.
    COUNT(DISTINCT CASE WHEN tipo = 'V' THEN CAST(data AS DATE) END) AS dias_venda
  FROM est_vendas
  WHERE data IS NOT NULL
  GROUP BY ALL
),
chaves AS (
  SELECT filial, item, mes FROM estoque
  UNION
  SELECT filial, item, mes FROM entrada
  UNION
  SELECT filial, item, mes FROM venda
),
-- Mês da posição atual: a foto mais recente (as colunas *_atual só têm valor nele).
atual AS (SELECT MAX(mes) AS mes_atual FROM estoque)
SELECT
  k.filial,
  k.item,
  CAST(strptime(k.mes || '-01', '%Y-%m-%d') AS DATE) AS data,
  k.mes,
  CAST(COALESCE(e.estoque_qtde, 0) AS DOUBLE) AS estoque_qtde,
  CAST(COALESCE(e.estoque_valor, 0) AS DOUBLE) AS estoque_valor,
  CAST(COALESCE(e.estoque_valor_venda, 0) AS DOUBLE) AS estoque_valor_venda,
  CAST(CASE WHEN k.mes = a.mes_atual THEN COALESCE(e.estoque_qtde, 0) ELSE 0 END AS DOUBLE) AS estoque_qtde_atual,
  CAST(CASE WHEN k.mes = a.mes_atual THEN COALESCE(e.estoque_valor, 0) ELSE 0 END AS DOUBLE) AS estoque_valor_atual,
  CAST(COALESCE(n.entrada_qtde, 0) AS DOUBLE) AS entrada_qtde,
  CAST(COALESCE(n.entrada_valor, 0) AS DOUBLE) AS entrada_valor,
  CAST(COALESCE(v.venda_qtde, 0) AS DOUBLE) AS venda_qtde,
  CAST(COALESCE(v.venda_valor, 0) AS DOUBLE) AS venda_valor,
  CAST(COALESCE(v.venda_custo, 0) AS DOUBLE) AS venda_custo,
  CAST(COALESCE(v.saida_qtde, 0) AS DOUBLE) AS saida_qtde,
  CAST(COALESCE(v.devolucao_qtde, 0) AS DOUBLE) AS devolucao_qtde,
  CAST(COALESCE(v.dias_venda, 0) AS DOUBLE) AS dias_venda
FROM chaves k
CROSS JOIN atual a
LEFT JOIN estoque e USING (filial, item, mes)
LEFT JOIN entrada n USING (filial, item, mes)
LEFT JOIN venda v USING (filial, item, mes)
