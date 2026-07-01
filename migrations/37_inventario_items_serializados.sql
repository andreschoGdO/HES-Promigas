-- ─────────────────────────────────────────────────────────────────
-- Phase 37 — Convertir inventario a items SERIALIZADOS
--
-- La migración 36 metió todo como consumables (cantidades). Pero
-- inversores, baterías, BMS y Top Cover son equipos SERIALIZADOS —
-- cada unidad tiene su QR/serial único y se debe trackear individualmente.
--
-- Este script:
--   1. Borra los consumables excepto Paneles Solares (que sí son
--      "consumibles" — cantidades sin serial individual)
--   2. Genera N filas en inventory_items por cada bodega × categoría,
--      con seriales placeholder tipo 'PEND-<CATEGORÍA>-<BODEGA>-###'
--   3. Los técnicos, al escanear QR reales en sitio, ACTUALIZAN el
--      serial_number del item placeholder correspondiente (o crean uno
--      nuevo si el placeholder ya fue consumido).
--
-- Total items serializados esperados: 499
-- Consumables restantes: 216 paneles JA Solar en Cali
-- ─────────────────────────────────────────────────────────────────

begin;

-- 1. Limpiar movements/reservas de items existentes (nada por ahora)
delete from inventory_movements where item_id is not null;
delete from inventory_reservations;
delete from inventory_items;

-- 2. Borrar consumables EXCEPTO los paneles solares
delete from inventory_consumables
 where category_id != (select id from inventory_categories where code = 'JASOLAR_PANEL_595W');

-- 3. Generar items serializados por cada (categoría × bodega) con cantidad > 0
--    usando una tabla temporal con el mapeo del CSV.
create temporary table _seed (
  cat_code text,
  wh_code text,
  qty integer,
  cost_cop numeric
);

-- BARRANQUILLA (134 unidades)
insert into _seed values
  ('LIVOLTEK_BAT_HV',    'BODEGA_BARRANQUILLA', 63, 4505104),
  ('LIVOLTEK_BMS',       'BODEGA_BARRANQUILLA', 24, 1747478),
  ('LIVOLTEK_INV_15KW',  'BODEGA_BARRANQUILLA', 15, 5567141),
  ('LIVOLTEK_INV_10KW',  'BODEGA_BARRANQUILLA', 6,  4985849),
  ('LIVOLTEK_TOP_COVER', 'BODEGA_BARRANQUILLA', 16, 1747478),
  ('DEYE_INV_15KW_HV',   'BODEGA_BARRANQUILLA', 3,  13840910),
  ('DEYE_BMS',           'BODEGA_BARRANQUILLA', 2,  4692396),
  ('DEYE_BAT_HV_4KWH',   'BODEGA_BARRANQUILLA', 5,  6573155);

-- CARTAGENA (229 unidades)
insert into _seed values
  ('LIVOLTEK_BAT_HV',    'BODEGA_CARTAGENA', 170, 4505104),
  ('LIVOLTEK_BMS',       'BODEGA_CARTAGENA', 15,  1747478),
  ('LIVOLTEK_INV_15KW',  'BODEGA_CARTAGENA', 14,  5567141),
  ('LIVOLTEK_INV_10KW',  'BODEGA_CARTAGENA', 4,   4985849),
  ('LIVOLTEK_TOP_COVER', 'BODEGA_CARTAGENA', 25,  1747478),
  ('DEYE_INV_15KW_HV',   'BODEGA_CARTAGENA', 1,   13840910);

-- CALI (136 unidades serializadas, más 216 paneles como consumable)
insert into _seed values
  ('LIVOLTEK_BAT_HV',    'BODEGA_CALI', 61, 4505104),
  ('LIVOLTEK_BMS',       'BODEGA_CALI', 15, 1747478),
  ('LIVOLTEK_INV_15KW',  'BODEGA_CALI', 11, 5567141),
  ('LIVOLTEK_INV_10KW',  'BODEGA_CALI', 3,  4985849),
  ('LIVOLTEK_TOP_COVER', 'BODEGA_CALI', 6,  1747478),
  ('DEYE_INV_15KW_HV',   'BODEGA_CALI', 4,  13840910),
  ('DEYE_BMS',           'BODEGA_CALI', 4,  4692396),
  ('DEYE_BAT_HV_4KWH',   'BODEGA_CALI', 11, 6573155),
  ('PYLONTECH_BAT_LV',   'BODEGA_CALI', 11, 6162641),
  ('PYLONTECH_BMS',      'BODEGA_CALI', 6,  2816695),
  ('DEYE_INV_6KW_LV',    'BODEGA_CALI', 4,  9363184);

-- Prefijos cortos por bodega para el serial (BQ, CT, CL)
create temporary table _wh_short as
  select 'BODEGA_BARRANQUILLA'::text as code, 'BQ'::text as short union all
  select 'BODEGA_CARTAGENA', 'CT' union all
  select 'BODEGA_CALI',      'CL';

-- Prefijos cortos por categoría para el serial (LBH, LBMS, ...)
create temporary table _cat_short as
  select 'LIVOLTEK_BAT_HV'::text as code, 'LBH'::text as short union all
  select 'LIVOLTEK_BMS',        'LBMS' union all
  select 'LIVOLTEK_INV_15KW',   'LINV15' union all
  select 'LIVOLTEK_INV_10KW',   'LINV10' union all
  select 'LIVOLTEK_TOP_COVER',  'LTC' union all
  select 'DEYE_INV_15KW_HV',    'DINV15' union all
  select 'DEYE_BMS',            'DBMS' union all
  select 'DEYE_BAT_HV_4KWH',    'DBH4' union all
  select 'DEYE_INV_6KW_LV',     'DINV6' union all
  select 'PYLONTECH_BAT_LV',    'PBL' union all
  select 'PYLONTECH_BMS',       'PBMS';

-- 4. Expandir _seed en filas individuales con serial placeholder
--    'PEND-<CAT_SHORT>-<WH_SHORT>-<N>' (N con padding a 3 dígitos)
insert into inventory_items (
  category_id,
  serial_number,
  brand,
  model,
  capacity_value,
  capacity_unit,
  status,
  current_location,
  warehouse_id,
  acquired_at,
  acquired_cost_cop,
  supplier,
  warranty_months,
  notes
)
select
  ic.id as category_id,
  'PEND-' || cs.short || '-' || ws.short || '-' || lpad(gs.n::text, 3, '0') as serial_number,
  ic.default_brand as brand,
  ic.default_model as model,
  ic.default_capacity_value as capacity_value,
  ic.default_capacity_unit as capacity_unit,
  'in_stock' as status,
  'warehouse' as current_location,
  w.id as warehouse_id,
  current_date as acquired_at,
  s.cost_cop as acquired_cost_cop,
  ic.default_brand as supplier,
  ic.default_warranty_months as warranty_months,
  'Serial placeholder — reemplazar por serial real al escanear QR en sitio' as notes
from _seed s
join inventory_categories ic on ic.code = s.cat_code
join warehouses w on w.code = s.wh_code
join _cat_short cs on cs.code = s.cat_code
join _wh_short ws on ws.code = s.wh_code
cross join lateral generate_series(1, s.qty) as gs(n);

-- 5. Marcar como is_serialized=false SOLO el panel solar
update inventory_categories set is_serialized = false where code = 'JASOLAR_PANEL_595W';

-- 6. Fijar default_cost_cop por categoría (los precios unitarios del CSV).
--    Facturación usa este valor cuando el item no tiene acquired_cost_cop propio.
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

drop table _seed;
drop table _wh_short;
drop table _cat_short;

commit;

-- ───── Verificación ─────
-- Items serializados por bodega:
--   select w.name, count(*) as items, sum(i.acquired_cost_cop) as valor
--     from inventory_items i join warehouses w on w.id = i.warehouse_id
--    group by w.name order by w.name;
-- Esperado:
--   Bodega Barranquilla: 134 items
--   Bodega Cartagena:    229 items
--   Bodega Cali:         136 items
--
-- Consumables restantes (solo paneles):
--   select name, stock_quantity from inventory_consumables;
-- Esperado:
--   Panel Solar JA Solar 595W: 216
