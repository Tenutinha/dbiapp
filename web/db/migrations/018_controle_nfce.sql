-- Controle: despesa lançada pelo QR Code da NFC-e guarda a chave de acesso da nota (44 dígitos),
-- para a mesma nota não ser lançada duas vezes no mesmo cliente.
ALTER TABLE controle_purchases ADD COLUMN IF NOT EXISTS nfce_key text CHECK (nfce_key ~ '^[0-9]{44}$');
CREATE UNIQUE INDEX IF NOT EXISTS controle_purchases_nfce_key_idx
  ON controle_purchases (client_id, nfce_key) WHERE nfce_key IS NOT NULL;
