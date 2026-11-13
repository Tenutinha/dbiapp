-- Títulos a pagar: uma linha por parcela.
SELECT
  chave_filial,
  nrtitulo,
  parcela,
  chave_fornecedor,
  chave_origem,
  chave_modalidade,
  CAST(dtemissao AS DATE) AS dtemissao,
  CAST(dtvencimento AS DATE) AS dtvencimento,
  CAST(dtpagamento AS DATE) AS dtpagamento,
  vlrtitulo,
  vlrpagamento,
  vlrsaldo,
  juros,
  multa,
  desconto,
  vlrjurosdiario,
  vlrmulta,
  analise_status,
  -- faixa_vencimento_status (DAX "Faixa Vencimento Status"): agrupa as faixas de vencimento —
  -- 1 quitado, 2 a 5 vencido, 6 a 9 a vencer; fora disso, vazio.
  CASE
    WHEN faixa_vencimento_ordem = 1 THEN 'Quitado'
    WHEN faixa_vencimento_ordem BETWEEN 2 AND 5 THEN 'Vencido'
    WHEN faixa_vencimento_ordem BETWEEN 6 AND 9 THEN 'À Vencer'
  END AS faixa_vencimento_status,
  faixa_vencimento_ordem,
  faixa_vencimento_nome,
  chave_filial_pagamento,
  pagamento_origem,
  -- modalidade_pagamento (DAX "Modalidade Pagamento"): por onde o título foi pago — os dados bancários
  -- quando pago por banco, o caixa quando pago em caixa, "Outros" no resto.
  CASE pagamento_origem
    WHEN 'Banco' THEN dados_bancarios
    WHEN 'Caixa' THEN caixa
    WHEN 'Outros' THEN 'Outros'
  END AS modalidade_pagamento
FROM fin_titulospagar
