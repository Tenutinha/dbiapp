-- Calendário: um dia por linha, do primeiro ao último dia que aparece nas fatos (fluxo pela data,
-- títulos pelo vencimento, saldos pela data do saldo).
WITH datas AS (
  SELECT data AS d FROM fluxo_de_caixa
  UNION ALL SELECT dtvencimento FROM titulosreceber
  UNION ALL SELECT dtvencimento FROM titulospagar
  UNION ALL SELECT datasaldo FROM saldos
),
limites AS (
  SELECT MIN(d) AS inicio, MAX(d) AS fim FROM datas
)
SELECT
  CAST(g.data AS DATE) AS data,
  strftime(g.data, '%Y') AS ano,
  strftime(g.data, '%Y-%m') AS mes
FROM limites, generate_series(CAST(limites.inicio AS TIMESTAMP), CAST(limites.fim AS TIMESTAMP), INTERVAL 1 DAY) AS g(data)
