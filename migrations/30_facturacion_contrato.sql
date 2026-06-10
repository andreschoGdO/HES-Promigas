-- ─────────────────────────────────────────────────────────────────
-- Phase 30 — Datos del contrato comercial en facturación
--
-- Captura los términos del contrato PPA / compraventa / mixto por proyecto:
--   - Tipo de contrato
--   - Fecha de inicio y duración
--   - Tarifa (COP/kWh) y/o cuota fija mensual
--   - URL del PDF del contrato firmado
--   - Estado contractual (firmado / activo / renovado / terminado)
--   - Garantía del sistema en meses (para calcular vencimiento)
--
-- Derivables (calculados en cliente):
--   - Fecha fin contrato = contract_start_date + contract_duration_months
--   - Fecha fin garantía = installation_date + system_warranty_months
--   - Ingreso esperado/mes ≈ monthly_fee_cop + tariff × kWh esperado
-- ─────────────────────────────────────────────────────────────────

alter table facturacion_records
  add column if not exists contract_type text
    check (contract_type in ('PPA', 'compraventa', 'mixto', 'leasing', 'otro')),
  add column if not exists contract_status text
    check (contract_status in ('pendiente_firma', 'activo', 'renovado', 'terminado', 'cancelado')),
  add column if not exists contract_start_date date,
  add column if not exists contract_duration_months integer,
  add column if not exists contract_url text,
  add column if not exists tariff_cop_per_kwh numeric,
  add column if not exists monthly_fee_cop numeric,
  add column if not exists system_warranty_months integer default 120;   -- 10 años default

create index if not exists idx_facturacion_contract_status on facturacion_records (contract_status) where contract_status is not null;
create index if not exists idx_facturacion_contract_end on facturacion_records ((contract_start_date + (contract_duration_months || ' months')::interval)) where contract_start_date is not null and contract_duration_months is not null;
