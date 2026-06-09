-- ============================================================================
-- Migración 22: agregar campos de dimensionado faltantes a crm_projects
-- ============================================================================
-- Añade:
--   - diseno_inversor_marca (text)
--   - diseno_inversor_potencia_kw (numeric)
--   - diseno_bateria_marca (text)
--   - diseno_bateria_capacidad_kwh (numeric) — capacidad por unidad
--   - tipo_red (text) — 'monofasica' | 'bifasica' | 'trifasica'
--
-- Ejecutar en Supabase SQL Editor. Idempotente (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE crm_projects
  ADD COLUMN IF NOT EXISTS diseno_inversor_marca         TEXT,
  ADD COLUMN IF NOT EXISTS diseno_inversor_potencia_kw   NUMERIC,
  ADD COLUMN IF NOT EXISTS diseno_bateria_marca          TEXT,
  ADD COLUMN IF NOT EXISTS diseno_bateria_capacidad_kwh  NUMERIC,
  ADD COLUMN IF NOT EXISTS tipo_red                      TEXT;

-- Constraint de dominio para tipo_red (acepta NULL para casas que aún no lo tienen)
ALTER TABLE crm_projects
  DROP CONSTRAINT IF EXISTS crm_projects_tipo_red_check;

ALTER TABLE crm_projects
  ADD CONSTRAINT crm_projects_tipo_red_check
  CHECK (tipo_red IS NULL OR tipo_red IN ('monofasica', 'bifasica', 'trifasica'));

-- Comentarios para documentar
COMMENT ON COLUMN crm_projects.diseno_inversor_marca        IS 'Marca del inversor a instalar (free text, ej: Livoltek, DEYE, Huawei)';
COMMENT ON COLUMN crm_projects.diseno_inversor_potencia_kw  IS 'Potencia nominal del inversor en kW';
COMMENT ON COLUMN crm_projects.diseno_bateria_marca         IS 'Marca de las baterías a instalar';
COMMENT ON COLUMN crm_projects.diseno_bateria_capacidad_kwh IS 'Capacidad por unidad de batería en kWh (multiplicar por diseno_baterias_cantidad para total)';
COMMENT ON COLUMN crm_projects.tipo_red                     IS 'Topología de red del sitio: monofasica / bifasica / trifasica';
