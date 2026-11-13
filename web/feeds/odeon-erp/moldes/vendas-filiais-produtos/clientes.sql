-- Clientes com as colunas que no Power BI eram DAX, calculadas sobre todas as vendas (sem filtro de período).
WITH por_cliente AS (
  SELECT
    cliente,
    -- Faturamento: soma do valor líquido de todas as linhas (vendas V e devoluções D, que vêm negativas).
    SUM(vlrliquido) AS faturamento,
    -- Custo: só das vendas (tipo V).
    SUM(vlrcue) FILTER (WHERE tipo = 'V') AS custo,
    -- Última compra: data da venda (tipo V) mais recente.
    MAX(data) FILTER (WHERE tipo = 'V') AS ultima_compra
  FROM vnd_vendas
  GROUP BY cliente
),
calculado AS (
  SELECT
    c.*,
    ROUND(COALESCE(v.faturamento, 0), 6) AS faturamento,
    -- Margem %: (faturamento - custo) / faturamento; vazia sem faturamento (DIVIDE do DAX).
    CASE WHEN ROUND(COALESCE(v.faturamento, 0), 6) <> 0
      THEN (v.faturamento - COALESCE(v.custo, 0)) / v.faturamento END AS margem_pct,
    -- Dias da última compra: dias entre a última compra e a data de referência; 0 se nunca comprou.
    COALESCE(date_diff('day', CAST(v.ultima_compra AS DATE), getvariable('data_referencia')), 0) AS dias_ultima_compra
  FROM vnd_clientes c
  LEFT JOIN por_cliente v ON v.cliente = c.cliente
)
SELECT
  cliente,
  razaosocial,
  regiao,
  uf,
  cidade,
  ibge,
  municipio,
  -- Classe do cliente pelo faturamento e pela margem % (margem vazia conta como 0, como no DAX).
  CASE
    WHEN faturamento >= 100000 AND COALESCE(margem_pct, 0) >= 0.5 THEN 'Platinum'
    WHEN faturamento >= 100000 THEN 'Premium'
    WHEN faturamento >= 25000 AND COALESCE(margem_pct, 0) >= 0.5 THEN 'Gold'
    WHEN faturamento >= 25000 THEN 'Silver'
    WHEN faturamento > 0 THEN 'Bronze'
    WHEN faturamento = 0 THEN 'New'
    -- Faturamento negativo (só devoluções): o DAX cai no "senão".
    ELSE 'ERRO DE CONFIGURAÇÃO'
  END AS classe_cliente,
  -- Recência: faixa dos dias desde a última compra (quem nunca comprou tem 0 dias e cai em "Até 1 mês").
  CASE
    WHEN dias_ultima_compra <= 30 THEN 'Até 1 mês'
    WHEN dias_ultima_compra <= 60 THEN 'Até 2 meses'
    WHEN dias_ultima_compra <= 90 THEN 'Até 3 meses'
    WHEN dias_ultima_compra <= 120 THEN 'Até 4 meses'
    WHEN dias_ultima_compra <= 360 THEN 'Até 1 ano'
    WHEN dias_ultima_compra <= 720 THEN 'Até 2 anos'
    ELSE 'Mais que 2 anos'
  END AS classe_cliente_dias,
  limitecredito
FROM calculado
