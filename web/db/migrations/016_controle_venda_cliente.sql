-- Controle: a venda passa a ser lançada só pelo valor (com forma de pagamento, data e, se a pessoa
-- quiser, o nome do cliente). O produto deixa de ser obrigatório; as vendas antigas mantêm o delas.
ALTER TABLE controle_sales ALTER COLUMN product DROP NOT NULL;
ALTER TABLE controle_sales ADD COLUMN IF NOT EXISTS customer_name text;
