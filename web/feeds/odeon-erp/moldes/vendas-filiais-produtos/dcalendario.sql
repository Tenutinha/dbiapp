-- Calendário diário de 01/01/2018 (ou da venda mais antiga, se anterior) até o fim do ano da data de referência,
-- como no Power Query (que ia até o fim do ano corrente).
WITH limites AS (
  SELECT
    LEAST(DATE '2018-01-01', COALESCE(CAST(MIN(data) AS DATE), DATE '2018-01-01')) AS inicio,
    CAST(date_trunc('year', getvariable('data_referencia')) + INTERVAL 1 YEAR - INTERVAL 1 DAY AS DATE) AS fim
  FROM vendas
)
SELECT
  CAST(d.dia AS DATE) AS data,
  CAST(year(d.dia) AS VARCHAR) AS ano
FROM limites, generate_series(CAST(limites.inicio AS TIMESTAMP), CAST(limites.fim AS TIMESTAMP), INTERVAL 1 DAY) AS d(dia)
