-- ─────────────────────────────────────────────────────────────────
-- Phase 38 — Family 'bms' para BMS / Control Box
--
-- En la migración 36 los BMS se marcaron como family='gateway' pero
-- conceptualmente NO son gateways (un gateway es un Pulsar de Metrum).
-- Panorama mostraba "66 Gateways" que era engañoso.
--
-- Este script:
--   1. Extiende la constraint de inventory_categories.family para
--      aceptar 'bms' como opción válida.
--   2. Migra las 3 categorías BMS de family='gateway' a family='bms'.
-- ─────────────────────────────────────────────────────────────────

begin;

-- 1. Extender el check constraint (Postgres no tiene 'if not exists' para
--    modificar constraints, usamos drop + add condicional)
alter table inventory_categories drop constraint if exists inventory_categories_family_check;
alter table inventory_categories add constraint inventory_categories_family_check
  check (family in (
    'inverter', 'battery', 'bms', 'panel', 'gateway',
    'meter', 'cable', 'breaker', 'tool', 'other'
  ));

-- 2. Migrar los BMS existentes de 'gateway' a 'bms'
update inventory_categories set family = 'bms'
 where code in ('LIVOLTEK_BMS', 'DEYE_BMS', 'PYLONTECH_BMS');

commit;

-- ───── Verificación ─────
--   select family, count(*) from inventory_categories group by family;
-- Esperado (después):
--   inverter: 4 (LIV 15, LIV 10, DEYE 15, DEYE 6)
--   battery:  3 (LIV, DEYE, Pylontech)
--   bms:      3 (LIV, DEYE, Pylontech)  ← nuevo
--   panel:    1 (JA Solar)
--   other:    1 (Livoltek Top Cover)
