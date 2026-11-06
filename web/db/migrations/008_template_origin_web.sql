-- Dashboards built directly for the web (no Power BI / QlikView original), e.g. the
-- Mapa da Votação election panels. They are kept out of the public showcase (/vitrine).
ALTER TABLE dashboard_templates DROP CONSTRAINT IF EXISTS dashboard_templates_origin_check;
ALTER TABLE dashboard_templates ADD CONSTRAINT dashboard_templates_origin_check
  CHECK (origin IN ('powerbi', 'qlikview', 'web'));
