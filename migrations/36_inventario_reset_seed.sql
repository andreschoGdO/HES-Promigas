-- ─────────────────────────────────────────────────────────────────
-- Phase 36 — RESET del inventario + seed con las 3 bodegas reales
--
-- ⚠️ DESTRUCTIVA: borra todos los items, consumibles, movimientos,
-- reservas y categorías existentes, y las bodegas anteriores. Sirve
-- para partir de cero con el CSV de inventario confirmado por operaciones.
--
-- Fuente: CSV "Avance Constructivo(Stock).csv" (junio 2026)
--
-- Estructura final:
--   3 bodegas: Barranquilla, Cartagena, Cali
--   12 categorías de equipo
--   26 filas de consumables (1 por categoría × bodega donde hay stock)
--   Precios unitarios COP incluidos en inventory_consumables.cost_per_unit_cop
--
-- Los items serializados quedan vacíos — se llenarán cuando los técnicos
-- escaneen QR en sitio. Los consumables tracking de cantidad muestran el
-- stock por bodega en la UI mientras tanto.
-- ─────────────────────────────────────────────────────────────────

begin;

-- ───── 1. Limpiar dependencias en orden seguro ─────
-- Movements dependen de items/consumables → borrar primero
delete from inventory_movements;

-- Reservas de visitas: liberamos primero para que no queden colgadas
delete from inventory_reservations;

-- Items serializados (equipos con QR)
delete from inventory_items;

-- Consumables (cantidades)
delete from inventory_consumables;

-- Categorías (sin items ni consumables referenciándolas, ok)
delete from inventory_categories;

-- Bodegas anteriores (después de todo lo anterior)
delete from warehouses;

-- ───── 2. Crear las 3 bodegas ─────
insert into warehouses (code, name, type, city, address, notes) values
  ('BODEGA_BARRANQUILLA', 'Bodega Barranquilla',   'central', 'Barranquilla', 'Barranquilla, Atlántico', 'Bodega regional Costa — Barranquilla'),
  ('BODEGA_CARTAGENA',    'Bodega Cartagena',       'central', 'Cartagena',    'Cartagena, Bolívar',      'Bodega regional Costa — Cartagena'),
  ('BODEGA_CALI',         'Bodega Cali',            'central', 'Cali',         'Cali, Valle del Cauca',   'Bodega principal Valle');

-- ───── 3. Categorías de equipo (12) ─────
insert into inventory_categories (code, name, family, description, default_brand, default_model, default_capacity_value, default_capacity_unit, default_warranty_months, is_serialized) values
  ('LIVOLTEK_BAT_HV',      'Batería Livoltek HV 5.1kWh',      'battery',     'Batería de Litio Livoltek 5,1 kWh HV (BHF-B10250R22001)',        'Livoltek', 'BHF-B10250R22001',        5.1,   'kWh', 120, true),
  ('LIVOLTEK_BMS',         'BMS Livoltek',                     'gateway',     'Dispositivo de control y gestión de batería Livoltek (BHF-C01ZYR25001)', 'Livoltek', 'BHF-C01ZYR25001', null,  null,  120, true),
  ('LIVOLTEK_INV_15KW',    'Inversor Livoltek HP3 15kW HV',    'inverter',    'Inversor híbrido Livoltek 15 kW trifásico 208/120V (HP315K2HW)',  'Livoltek', 'HP315K2HW',               15,    'kW',  120, true),
  ('LIVOLTEK_INV_10KW',    'Inversor Livoltek HP3 10kW HV',    'inverter',    'Inversor híbrido Livoltek 10 kW trifásico 208/120V (HP310K2HW)',  'Livoltek', 'HP310K2HW',               10,    'kW',  120, true),
  ('LIVOLTEK_TOP_COVER',   'Top Cover Litio HV Livoltek',      'other',       'Dispositivo para conexión en paralelo de baterías Livoltek (BHO-20500N)', 'Livoltek', 'BHO-20500N',      null,  null,  120, true),
  ('DEYE_INV_15KW_HV',     'Inversor DEYE 15kW HV',            'inverter',    'Inversor híbrido DEYE 15 kW trifásico 208/120V (SUN-15K-SG01HP3-US-AM2)', 'DEYE',     'SUN-15K-SG01HP3-US-AM2', 15, 'kW', 120, true),
  ('DEYE_BMS',             'BMS DEYE',                         'gateway',     'Control Box GB-LBS+GB-LBASE DEYE',                                'DEYE',     'GB-LBS+GB-LBASE',         null,  null,  120, true),
  ('DEYE_BAT_HV_4KWH',     'Batería DEYE 4kWh HV',             'battery',     'Batería de Litio DEYE 4,09 kWh 200 A VDC HV',                     'DEYE',     'BAT-4KWH-200VDC',         4.09,  'kWh', 120, true),
  ('DEYE_INV_6KW_LV',      'Inversor DEYE 6kW LV',             'inverter',    'Inversor híbrido DEYE 6 kW trifásico 208/120V (Low Voltage)',    'DEYE',     'SUN-6K-SG01LP3-US',       6,     'kW',  120, true),
  ('PYLONTECH_BAT_LV',     'Batería Pylontech 3.552kWh LV',    'battery',     'Batería de Litio Pylontech 3,552 kWh LV',                         'Pylontech','US3000C',                 3.552, 'kWh', 120, true),
  ('PYLONTECH_BMS',        'BMS Pylontech',                    'gateway',     'Dispositivo de control y gestión de batería Pylontech',           'Pylontech','SC1000',                  null,  null,  120, true),
  ('JASOLAR_PANEL_595W',   'Panel Solar JA Solar 595W',        'panel',       'Panel solar JA Solar 595 Wp monocristalino',                      'JA Solar', 'JAM72D40-595/MB',         595,   'Wp',  120, false);

-- ───── 4. Consumables por bodega según CSV ─────

-- BODEGA BARRANQUILLA (134 unidades total ≈ $551M)
insert into inventory_consumables (category_id, warehouse_id, name, unit, stock_quantity, cost_per_unit_cop, min_threshold) values
  ((select id from inventory_categories where code = 'LIVOLTEK_BAT_HV'),    (select id from warehouses where code = 'BODEGA_BARRANQUILLA'), 'Batería Livoltek HV 5.1kWh',   'ud', 63, 4505104, 5),
  ((select id from inventory_categories where code = 'LIVOLTEK_BMS'),       (select id from warehouses where code = 'BODEGA_BARRANQUILLA'), 'BMS Livoltek',                 'ud', 24, 1747478, 3),
  ((select id from inventory_categories where code = 'LIVOLTEK_INV_15KW'),  (select id from warehouses where code = 'BODEGA_BARRANQUILLA'), 'Inversor Livoltek 15kW HV',    'ud', 15, 5567141, 2),
  ((select id from inventory_categories where code = 'LIVOLTEK_INV_10KW'),  (select id from warehouses where code = 'BODEGA_BARRANQUILLA'), 'Inversor Livoltek 10kW HV',    'ud', 6,  4985849, 2),
  ((select id from inventory_categories where code = 'LIVOLTEK_TOP_COVER'), (select id from warehouses where code = 'BODEGA_BARRANQUILLA'), 'Top Cover Livoltek HV',        'ud', 16, 1747478, 2),
  ((select id from inventory_categories where code = 'DEYE_INV_15KW_HV'),   (select id from warehouses where code = 'BODEGA_BARRANQUILLA'), 'Inversor DEYE 15kW HV',        'ud', 3,  13840910, 1),
  ((select id from inventory_categories where code = 'DEYE_BMS'),           (select id from warehouses where code = 'BODEGA_BARRANQUILLA'), 'BMS DEYE',                     'ud', 2,  4692396, 1),
  ((select id from inventory_categories where code = 'DEYE_BAT_HV_4KWH'),   (select id from warehouses where code = 'BODEGA_BARRANQUILLA'), 'Batería DEYE 4kWh HV',         'ud', 5,  6573155, 1);

-- BODEGA CARTAGENA (229 unidades total ≈ $947M)
insert into inventory_consumables (category_id, warehouse_id, name, unit, stock_quantity, cost_per_unit_cop, min_threshold) values
  ((select id from inventory_categories where code = 'LIVOLTEK_BAT_HV'),    (select id from warehouses where code = 'BODEGA_CARTAGENA'), 'Batería Livoltek HV 5.1kWh',   'ud', 170, 4505104, 10),
  ((select id from inventory_categories where code = 'LIVOLTEK_BMS'),       (select id from warehouses where code = 'BODEGA_CARTAGENA'), 'BMS Livoltek',                 'ud', 15,  1747478, 3),
  ((select id from inventory_categories where code = 'LIVOLTEK_INV_15KW'),  (select id from warehouses where code = 'BODEGA_CARTAGENA'), 'Inversor Livoltek 15kW HV',    'ud', 14,  5567141, 2),
  ((select id from inventory_categories where code = 'LIVOLTEK_INV_10KW'),  (select id from warehouses where code = 'BODEGA_CARTAGENA'), 'Inversor Livoltek 10kW HV',    'ud', 4,   4985849, 2),
  ((select id from inventory_categories where code = 'LIVOLTEK_TOP_COVER'), (select id from warehouses where code = 'BODEGA_CARTAGENA'), 'Top Cover Livoltek HV',        'ud', 25,  1747478, 3),
  ((select id from inventory_categories where code = 'DEYE_INV_15KW_HV'),   (select id from warehouses where code = 'BODEGA_CARTAGENA'), 'Inversor DEYE 15kW HV',        'ud', 1,   13840910, 1);

-- BODEGA CALI (136 unidades total ≈ $717M)
insert into inventory_consumables (category_id, warehouse_id, name, unit, stock_quantity, cost_per_unit_cop, min_threshold) values
  ((select id from inventory_categories where code = 'LIVOLTEK_BAT_HV'),    (select id from warehouses where code = 'BODEGA_CALI'), 'Batería Livoltek HV 5.1kWh',   'ud', 61,  4505104, 5),
  ((select id from inventory_categories where code = 'LIVOLTEK_BMS'),       (select id from warehouses where code = 'BODEGA_CALI'), 'BMS Livoltek',                 'ud', 15,  1747478, 3),
  ((select id from inventory_categories where code = 'LIVOLTEK_INV_15KW'),  (select id from warehouses where code = 'BODEGA_CALI'), 'Inversor Livoltek 15kW HV',    'ud', 11,  5567141, 2),
  ((select id from inventory_categories where code = 'LIVOLTEK_INV_10KW'),  (select id from warehouses where code = 'BODEGA_CALI'), 'Inversor Livoltek 10kW HV',    'ud', 3,   4985849, 2),
  ((select id from inventory_categories where code = 'LIVOLTEK_TOP_COVER'), (select id from warehouses where code = 'BODEGA_CALI'), 'Top Cover Livoltek HV',        'ud', 6,   1747478, 2),
  ((select id from inventory_categories where code = 'DEYE_INV_15KW_HV'),   (select id from warehouses where code = 'BODEGA_CALI'), 'Inversor DEYE 15kW HV',        'ud', 4,   13840910, 1),
  ((select id from inventory_categories where code = 'DEYE_BMS'),           (select id from warehouses where code = 'BODEGA_CALI'), 'BMS DEYE',                     'ud', 4,   4692396, 1),
  ((select id from inventory_categories where code = 'DEYE_BAT_HV_4KWH'),   (select id from warehouses where code = 'BODEGA_CALI'), 'Batería DEYE 4kWh HV',         'ud', 11,  6573155, 2),
  ((select id from inventory_categories where code = 'PYLONTECH_BAT_LV'),   (select id from warehouses where code = 'BODEGA_CALI'), 'Batería Pylontech 3.552kWh LV', 'ud', 11,  6162641, 2),
  ((select id from inventory_categories where code = 'PYLONTECH_BMS'),      (select id from warehouses where code = 'BODEGA_CALI'), 'BMS Pylontech',                'ud', 6,   2816695, 1),
  ((select id from inventory_categories where code = 'DEYE_INV_6KW_LV'),    (select id from warehouses where code = 'BODEGA_CALI'), 'Inversor DEYE 6kW LV',         'ud', 4,   9363184, 1),
  ((select id from inventory_categories where code = 'JASOLAR_PANEL_595W'), (select id from warehouses where code = 'BODEGA_CALI'), 'Panel Solar JA Solar 595W',    'ud', 216, 280634,  20);

commit;

-- ───── Verificación ─────
-- Ejecutar después para verificar:
--   select w.name as bodega, sum(c.stock_quantity) as unidades, sum(c.stock_quantity * c.cost_per_unit_cop) as valor_cop
--     from inventory_consumables c
--     join warehouses w on w.id = c.warehouse_id
--    group by w.name
--    order by w.name;
--
-- Esperado:
--   Bodega Barranquilla: 134 unidades ≈ $550.9M
--   Bodega Cartagena:    229 unidades ≈ $947.5M
--   Bodega Cali:         136 unidades ≈ $716.9M
