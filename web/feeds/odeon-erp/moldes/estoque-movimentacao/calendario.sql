-- Calendário: um mês por linha (primeiro dia), os meses que aparecem no movimento.
SELECT DISTINCT
  data,
  CAST(year(data) AS VARCHAR) AS ano,
  mes
FROM movimento
