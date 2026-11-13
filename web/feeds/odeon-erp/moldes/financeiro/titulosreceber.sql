-- Títulos a receber: uma linha por recebimento de parcela.
SELECT
  chave_filial,
  chave_cliente,
  nrtitulo,
  parcela,
  CAST(dtemissao AS DATE) AS dtemissao,
  CAST(dtvencimento AS DATE) AS dtvencimento,
  CAST(dtrecebimento AS DATE) AS dtrecebimento,
  -- Uma parcela pode ter várias linhas (recebimentos parciais) repetindo o valor e o saldo do título:
  -- divide-se pelo número de linhas da parcela (nrtitulo + parcela) para a soma não duplicar.
  vlrtitulo / COUNT(*) OVER (PARTITION BY nrtitulo, parcela) AS vlrtitulo_rateado,
  vlrsaldo / COUNT(*) OVER (PARTITION BY nrtitulo, parcela) AS vlrsaldo_rateado,
  vlrrecebido,
  vlrjuros,
  vlrmulta,
  chave_cartao,
  chave_origem,
  chave_modalidade,
  analise_status,
  dias_ate_vencimento,
  -- dias_ate_o_vencimento_2 (DAX "Dias Até o Vencimento 2"): a distância em dias, sem sinal, em texto.
  -- Vazio conta como zero, como no DAX (BLANK() = 0).
  CASE ABS(COALESCE(dias_ate_vencimento, 0))
    WHEN 0 THEN 'Hoje'
    WHEN 1 THEN 'Amanhã'
    ELSE 'Em ' || ABS(dias_ate_vencimento) || ' dias'
  END AS dias_ate_o_vencimento_2,
  vendaprazo
FROM fin_titulosreceber
