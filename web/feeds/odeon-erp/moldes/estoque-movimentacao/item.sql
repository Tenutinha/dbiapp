-- Produtos: cadastro do modelo mais a curva ABC (coluna DAX "ABC Produto" do projeto Estoque).
WITH total AS (
  -- "_Total Quantidade": quantidade vendida do item (só tipo V), em todo o histórico e todas as filiais.
  SELECT item, SUM(qtde) AS total_quantidade
  FROM est_vendas
  WHERE tipo = 'V'
  GROUP BY item
),
curva AS (
  SELECT
    i.*,
    t.total_quantidade,
    -- "_Quantidade Acumulada": soma dos itens que venderam tanto ou mais que este (empates entram juntos).
    SUM(t.total_quantidade) OVER (
      ORDER BY t.total_quantidade DESC NULLS LAST
      RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS quantidade_acumulada,
    -- Denominador do "_% Quantidade": total vendido de todos os itens do cadastro.
    SUM(t.total_quantidade) OVER () AS quantidade_geral
  FROM est_item i
  LEFT JOIN total t USING (item)
)
SELECT
  item,
  codigo_e_descricao,
  linha,
  grupo,
  sub_grupo,
  marca_nome,
  -- Curva ABC por quantidade: A até 70% do acumulado, B até 90%, C até 100%; item sem venda fica "Sem curva".
  CASE
    WHEN NOT total_quantidade > 0 OR total_quantidade IS NULL THEN 'Sem curva'
    WHEN quantidade_acumulada / quantidade_geral <= 0.7 THEN 'A'
    WHEN quantidade_acumulada / quantidade_geral <= 0.9 THEN 'B'
    WHEN quantidade_acumulada / quantidade_geral <= 1 THEN 'C'
    ELSE 'Sem curva'
  END AS abc_produto,
  cor,
  tamanho,
  -- Dias de recompra do cadastro (diasrecompra no modelo).
  CAST(diasrecompra AS DOUBLE) AS dias_recompra
FROM curva
