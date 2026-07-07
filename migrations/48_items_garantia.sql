-- ─────────────────────────────────────────────────────────────────
-- Phase 48 — 2 equipos en proceso de garantía
--
-- Al retirar la etapa 'logistica_inversa' del CRM (mig 47), la gestión de
-- garantías vive en /inventario por equipo. Se agregan 2 items con
-- status = 'in_repair' (proceso de garantía activo):
--
--   1. Batería Livoltek HV — en trámite
--   2. BMS Deye — iniciando proceso
--
-- Sin bodega asignada (warehouse_id = null) porque están en manos del
-- proveedor / taller. Al volver, la operación de inventario los reasignará.
-- ─────────────────────────────────────────────────────────────────

begin;

insert into inventory_items (
  category_id, serial_number, brand, model, capacity_value, capacity_unit,
  status, current_location, acquired_at, notes, created_by
)
values
  (
    (select id from inventory_categories where code = 'LIVOLTEK_BAT_HV'),
    'WAR-LBH-001',
    'Livoltek', 'BHF-B10250R22001', 5.1, 'kWh',
    'in_repair', 'supplier_rma', current_date,
    'Garantía en trámite — batería con falla reportada',
    'seed-mig-48'
  ),
  (
    (select id from inventory_categories where code = 'DEYE_BMS'),
    'WAR-DBMS-001',
    'DEYE', 'GB-LBS+GB-LBASE', null, null,
    'in_repair', 'supplier_rma', current_date,
    'Garantía iniciando proceso — BMS con diagnóstico pendiente',
    'seed-mig-48'
  );

-- Movimientos que dejan rastro del ingreso a garantía
insert into inventory_movements (item_id, type, from_status, to_status, from_location, to_location, responsible_email, notes)
select id, 'repair_start', 'in_stock', 'in_repair', 'warehouse', 'supplier_rma',
       'seed-mig-48',
       'Ingreso a garantía (seed mig 48)'
  from inventory_items
 where created_by = 'seed-mig-48';

commit;

-- Verificación:
-- select serial_number, brand, model, status, notes from inventory_items
--  where created_by = 'seed-mig-48';
-- Esperado: 2 rows en status='in_repair'
