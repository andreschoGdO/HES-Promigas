-- ─────────────────────────────────────────────────────────────────
-- Phase 37 — Convertir inventario a items SERIALIZADOS
--
-- La migración 36 metió todo como consumables. Pero inversores, baterías,
-- BMS y Top Cover son equipos SERIALIZADOS. Solo paneles quedan como
-- consumables (216 pallets en Cali).
--
-- Los items serializados se crean con serial placeholder tipo
-- 'PEND-<CAT>-<BODEGA>-###'. Los técnicos actualizarán el serial real
-- cuando escaneen QR en sitio.
-- ─────────────────────────────────────────────────────────────────

begin;

-- 1. Limpiar movements/reservas/items
delete from inventory_movements where item_id is not null;
delete from inventory_reservations;
delete from inventory_items;

-- 2. Borrar consumables excepto paneles solares
delete from inventory_consumables
 where category_id != (select id from inventory_categories where code = 'JASOLAR_PANEL_595W');

-- 3. Insertar items serializados usando CTEs (funciona en cualquier contexto).
--    Cada (categoría × bodega × N) genera 1 fila con serial PEND-<CAT>-<BQ|CT|CL>-###.
with seed(cat_code, wh_code, qty, cost_cop, cat_short, wh_short) as (
  values
    -- BARRANQUILLA (134)
    ('LIVOLTEK_BAT_HV',    'BODEGA_BARRANQUILLA', 63, 4505104::numeric,  'LBH',    'BQ'),
    ('LIVOLTEK_BMS',       'BODEGA_BARRANQUILLA', 24, 1747478::numeric,  'LBMS',   'BQ'),
    ('LIVOLTEK_INV_15KW',  'BODEGA_BARRANQUILLA', 15, 5567141::numeric,  'LINV15', 'BQ'),
    ('LIVOLTEK_INV_10KW',  'BODEGA_BARRANQUILLA', 6,  4985849::numeric,  'LINV10', 'BQ'),
    ('LIVOLTEK_TOP_COVER', 'BODEGA_BARRANQUILLA', 16, 1747478::numeric,  'LTC',    'BQ'),
    ('DEYE_INV_15KW_HV',   'BODEGA_BARRANQUILLA', 3,  13840910::numeric, 'DINV15', 'BQ'),
    ('DEYE_BMS',           'BODEGA_BARRANQUILLA', 2,  4692396::numeric,  'DBMS',   'BQ'),
    ('DEYE_BAT_HV_4KWH',   'BODEGA_BARRANQUILLA', 5,  6573155::numeric,  'DBH4',   'BQ'),
    -- CARTAGENA (229)
    ('LIVOLTEK_BAT_HV',    'BODEGA_CARTAGENA', 170, 4505104::numeric,  'LBH',    'CT'),
    ('LIVOLTEK_BMS',       'BODEGA_CARTAGENA', 15,  1747478::numeric,  'LBMS',   'CT'),
    ('LIVOLTEK_INV_15KW',  'BODEGA_CARTAGENA', 14,  5567141::numeric,  'LINV15', 'CT'),
    ('LIVOLTEK_INV_10KW',  'BODEGA_CARTAGENA', 4,   4985849::numeric,  'LINV10', 'CT'),
    ('LIVOLTEK_TOP_COVER', 'BODEGA_CARTAGENA', 25,  1747478::numeric,  'LTC',    'CT'),
    ('DEYE_INV_15KW_HV',   'BODEGA_CARTAGENA', 1,   13840910::numeric, 'DINV15', 'CT'),
    -- CALI (136 serializados)
    ('LIVOLTEK_BAT_HV',    'BODEGA_CALI', 61, 4505104::numeric,  'LBH',    'CL'),
    ('LIVOLTEK_BMS',       'BODEGA_CALI', 15, 1747478::numeric,  'LBMS',   'CL'),
    ('LIVOLTEK_INV_15KW',  'BODEGA_CALI', 11, 5567141::numeric,  'LINV15', 'CL'),
    ('LIVOLTEK_INV_10KW',  'BODEGA_CALI', 3,  4985849::numeric,  'LINV10', 'CL'),
    ('LIVOLTEK_TOP_COVER', 'BODEGA_CALI', 6,  1747478::numeric,  'LTC',    'CL'),
    ('DEYE_INV_15KW_HV',   'BODEGA_CALI', 4,  13840910::numeric, 'DINV15', 'CL'),
    ('DEYE_BMS',           'BODEGA_CALI', 4,  4692396::numeric,  'DBMS',   'CL'),
    ('DEYE_BAT_HV_4KWH',   'BODEGA_CALI', 11, 6573155::numeric,  'DBH4',   'CL'),
    ('PYLONTECH_BAT_LV',   'BODEGA_CALI', 11, 6162641::numeric,  'PBL',    'CL'),
    ('PYLONTECH_BMS',      'BODEGA_CALI', 6,  2816695::numeric,  'PBMS',   'CL'),
    ('DEYE_INV_6KW_LV',    'BODEGA_CALI', 4,  9363184::numeric,  'DINV6',  'CL')
)
insert into inventory_items (
  category_id, serial_number, brand, model, capacity_value, capacity_unit,
  status, current_location, warehouse_id, acquired_at, acquired_cost_cop,
  supplier, warranty_months, notes
)
select
  ic.id,
  'PEND-' || s.cat_short || '-' || s.wh_short || '-' || lpad(gs.n::text, 3, '0'),
  ic.default_brand,
  ic.default_model,
  ic.default_capacity_value,
  ic.default_capacity_unit,
  'in_stock',
  'warehouse',
  w.id,
  current_date,
  s.cost_cop,
  ic.default_brand,
  ic.default_warranty_months,
  'Serial placeholder — reemplazar por serial real al escanear QR en sitio'
from seed s
join inventory_categories ic on ic.code = s.cat_code
join warehouses w on w.code = s.wh_code
cross join lateral generate_series(1, s.qty) as gs(n);

-- 4. Panel solar es el único no-serializado
update inventory_categories set is_serialized = false where code = 'JASOLAR_PANEL_595W';

-- 5. default_cost_cop por categoría (precios del CSV)
update inventory_categories set default_cost_cop = 4505104  where code = 'LIVOLTEK_BAT_HV';
update inventory_categories set default_cost_cop = 1747478  where code = 'LIVOLTEK_BMS';
update inventory_categories set default_cost_cop = 5567141  where code = 'LIVOLTEK_INV_15KW';
update inventory_categories set default_cost_cop = 4985849  where code = 'LIVOLTEK_INV_10KW';
update inventory_categories set default_cost_cop = 1747478  where code = 'LIVOLTEK_TOP_COVER';
update inventory_categories set default_cost_cop = 13840910 where code = 'DEYE_INV_15KW_HV';
update inventory_categories set default_cost_cop = 4692396  where code = 'DEYE_BMS';
update inventory_categories set default_cost_cop = 6573155  where code = 'DEYE_BAT_HV_4KWH';
update inventory_categories set default_cost_cop = 9363184  where code = 'DEYE_INV_6KW_LV';
update inventory_categories set default_cost_cop = 6162641  where code = 'PYLONTECH_BAT_LV';
update inventory_categories set default_cost_cop = 2816695  where code = 'PYLONTECH_BMS';
update inventory_categories set default_cost_cop = 280634   where code = 'JASOLAR_PANEL_595W';

commit;

-- ───── Verificación ─────
--   select w.name, count(*) as items
--     from inventory_items i join warehouses w on w.id = i.warehouse_id
--    group by w.name order by w.name;
-- Esperado: Barranquilla 134, Cartagena 229, Cali 136
