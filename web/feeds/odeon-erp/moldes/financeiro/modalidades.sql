-- Modalidades de recebimento e pagamento.
SELECT
  chave_modalidade,
  modalidade_descricao,
  -- pode_atrasar (DAX "Pode Atrasar"): cartão e PIX são liquidados pela operadora ou pelo banco, então
  -- título nessas modalidades não conta como atraso do cliente ("N"); as demais podem atrasar ("S").
  CASE
    WHEN modalidade_descricao IN ('Cartao Credito', 'PIX', 'Pix - Pgto Eletronico', 'Cartao Debito') THEN 'N'
    ELSE 'S'
  END AS pode_atrasar
FROM fin_modalidades
