-- Meta mensal de faturamento por filial (uma linha por filial e mês, datada no último dia do mês).
SELECT
  filial,
  CAST(data AS DATE) AS data,
  vlrmeta_total
FROM vnd_planejamento_filial_mensal
