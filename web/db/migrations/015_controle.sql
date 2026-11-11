-- Módulo "controle": o cliente de uma organização registra compras (com o comprovante guardado e
-- tabulado por IA) e lança vendas. Diferente do resto da plataforma, aqui quem digita é o próprio
-- usuário do cliente — por isso o módulo é ligado organização por organização.

-- Módulos opcionais ligados na organização (hoje só 'controle').
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS modules text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS controle_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  purchased_on date NOT NULL,
  supplier text,
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  payment_method text,
  notes text,
  -- Caminho do comprovante relativo à pasta do cliente (a pasta muda de nome com o endereço do cliente).
  receipt_path text,
  receipt_mime text,
  -- 'ai' = tabulada a partir do comprovante; 'manual' = digitada.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('ai', 'manual')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES org_clients(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS controle_purchases_client_day_idx ON controle_purchases (client_id, purchased_on DESC);
-- Um comprovante pertence a uma única compra (excluir a compra apaga o arquivo).
CREATE UNIQUE INDEX IF NOT EXISTS controle_purchases_receipt_idx ON controle_purchases (client_id, receipt_path)
  WHERE receipt_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS controle_purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES controle_purchases(id) ON DELETE CASCADE,
  position int NOT NULL,
  description text NOT NULL,
  quantity numeric(14, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text,
  unit_price_cents bigint CHECK (unit_price_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0)
);

CREATE INDEX IF NOT EXISTS controle_purchase_items_purchase_idx ON controle_purchase_items (purchase_id, position);

CREATE TABLE IF NOT EXISTS controle_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  sold_on date NOT NULL,
  product text NOT NULL,
  quantity numeric(14, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents bigint CHECK (unit_price_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  payment_method text,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES org_clients(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS controle_sales_client_day_idx ON controle_sales (client_id, sold_on DESC);

-- Fechadas para a REST do Supabase como todas as outras (o app conecta como dono; ver 006).
ALTER TABLE controle_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_sales ENABLE ROW LEVEL SECURITY;

-- A organização "controle" é a primeira a usar o módulo (não faz nada onde ela não existe).
UPDATE organizations SET modules = array_append(modules, 'controle')
WHERE slug = 'controle' AND NOT ('controle' = ANY (modules));
