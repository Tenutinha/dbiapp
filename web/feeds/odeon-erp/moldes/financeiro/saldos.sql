-- Saldos de banco e caixa por dia.
SELECT
  CAST(datasaldo AS DATE) AS datasaldo,
  filial,
  banco_caixa,
  saldo_origem,
  vlrsaldo,
  -- saldo_atual: o saldo da conta só no último dia em que ela aparece (zero nos demais), para que a
  -- soma dê a posição atual de todas as contas.
  CASE
    WHEN datasaldo = MAX(datasaldo) OVER (PARTITION BY filial, saldo_origem, banco_caixa) THEN vlrsaldo
    ELSE 0
  END AS saldo_atual
FROM fin_saldos
