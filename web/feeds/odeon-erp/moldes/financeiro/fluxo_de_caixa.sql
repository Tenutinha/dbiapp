-- Fluxo de caixa (a tabela calculada "Fluxo de Caixa" do DAX): realizado ("Assumido") e previsto
-- ("Previsão") de receber e pagar, com Receber positivo e Pagar negativo. Cada parte é um SUMMARIZE do
-- DAX, isto é, as combinações distintas das colunas listadas; as quatro partes se juntam com UNION ALL.
WITH pagar_assumido AS (
  -- Pagamentos feitos: título que não é previsão e tem data de pagamento.
  SELECT DISTINCT chave_filial, parcela, nrtitulo, chave_origem, dtpagamento AS data, origem,
    chave_modalidade, vlrpagamento AS valor, banco_caixa
  FROM fin_titulospagar
  WHERE flgprevisao = 'N' AND dtpagamento IS NOT NULL
),
recebido_assumido AS (
  -- Recebimentos feitos (em dia ou com atraso), pela data do recebimento.
  SELECT DISTINCT chave_filial, parcela, nrtitulo, chave_origem, dtrecebimento AS data, origem,
    chave_modalidade, vlrrecebido AS valor
  FROM fin_titulosreceber
  WHERE analise_status IN ('Recebido com atraso', 'Recebido em dia')
),
pagar_previsao AS (
  -- A pagar: títulos pendentes que não são previsão, pelo saldo, na data de vencimento.
  SELECT DISTINCT chave_filial, parcela, nrtitulo, chave_origem, dtvencimento AS data, origem,
    chave_modalidade, vlrsaldo AS valor, banco_caixa
  FROM fin_titulospagar
  WHERE pendentes = 'S' AND flgprevisao = 'N'
),
recebido_previsao AS (
  -- A receber: títulos previstos ou atrasados, pelo valor do título, na data de vencimento.
  SELECT DISTINCT chave_filial, parcela, nrtitulo, chave_origem, dtvencimento AS data, origem,
    chave_modalidade, vlrtitulo AS valor
  FROM fin_titulosreceber
  WHERE analise_status IN ('Previsto', 'Atrasado')
),
lancamentos AS (
  SELECT chave_filial, data, origem, 'Assumido' AS tipo, chave_origem, chave_modalidade, -valor AS valor FROM pagar_assumido
  UNION ALL
  SELECT chave_filial, data, origem, 'Assumido', chave_origem, chave_modalidade, valor FROM recebido_assumido
  UNION ALL
  SELECT chave_filial, data, origem, 'Previsão', chave_origem, chave_modalidade, -valor FROM pagar_previsao
  UNION ALL
  SELECT chave_filial, data, origem, 'Previsão', chave_origem, chave_modalidade, valor FROM recebido_previsao
)
SELECT chave_filial, CAST(data AS DATE) AS data, origem, tipo, chave_origem, chave_modalidade, valor
FROM lancamentos
