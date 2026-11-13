-- Vendas (tipo V) e devoluções (tipo D), uma linha por item; a data vira DATE (sem hora).
SELECT
  filial,
  tipo,
  nrsaida,
  CAST(data AS DATE) AS data,
  cliente,
  plano_pagamento,
  vendedor,
  item,
  qtde,
  desconto,
  vlrliquido,
  vlrliquido_antigo,
  vlrcue,
  destino_compra
FROM vnd_vendas
