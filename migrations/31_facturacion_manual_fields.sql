-- ─────────────────────────────────────────────────────────────────
-- Phase 31 — Campos manuales adicionales en Facturación
--
-- Cubre lo que falta para auditoría contable y comercial. Todos son
-- captura manual desde /facturacion clickeando la celda. No se derivan
-- automáticamente; quedan para que el usuario los llene cuando los tenga.
-- ─────────────────────────────────────────────────────────────────

alter table facturacion_records
  -- Financiero (cuentas por cobrar)
  add column if not exists revenue_billed_cop numeric,    -- Ingreso facturado acumulado
  add column if not exists balance_due_cop numeric,       -- Saldo pendiente / morosidad
  add column if not exists first_billing_date date,       -- Fecha del primer cobro
  -- Comercial
  add column if not exists salesperson text,              -- Vendedor / asesor que cerró la venta
  -- Documentación
  add column if not exists contract_notes text,           -- Cláusulas especiales del contrato
  add column if not exists acta_instalacion_url text,     -- PDF del acta firmada
  add column if not exists certificado_legalizacion_url text;  -- Certificado RETIE / OR
