-- Controle: cada lançamento tem uma situação — "pendente" (ainda vai ser pago ou recebido) ou
-- "efetivado" (a pessoa confirmou que aconteceu). Os lançamentos que já existem ficam efetivados.
ALTER TABLE controle_purchases ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'efetivado'
  CHECK (status IN ('pendente', 'efetivado'));
ALTER TABLE controle_sales ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'efetivado'
  CHECK (status IN ('pendente', 'efetivado'));
