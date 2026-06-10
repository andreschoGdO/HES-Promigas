-- ─────────────────────────────────────────────────────────────────
-- Phase 26 — Unificar RMA en "En garantía"
--
-- El usuario decidió que "RMA con proveedor" y "En garantía / taller"
-- son operativamente lo mismo. Se unifican bajo `in_repair`.
--
-- Para no romper movimientos históricos, NO se borran filas — solo se
-- migran items en status='rma' a 'in_repair' y se actualiza el CHECK
-- constraint para no permitir 'rma' a futuro.
--
-- Los movimientos type='rma_send' y 'rma_return' siguen siendo válidos
-- en inventory_movements para preservar el histórico, pero ya no se
-- generan nuevos desde la UI.
-- ─────────────────────────────────────────────────────────────────

-- 1. Migrar items existentes
update inventory_items set status = 'in_repair' where status = 'rma';

-- 2. Actualizar el CHECK para no permitir más rma
alter table inventory_items drop constraint if exists inventory_items_status_check;
alter table inventory_items add constraint inventory_items_status_check
  check (status in ('in_stock', 'reserved', 'installed', 'in_repair', 'decommissioned'));
