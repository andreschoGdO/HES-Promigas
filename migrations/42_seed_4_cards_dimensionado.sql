-- ─────────────────────────────────────────────────────────────────
-- Phase 42 — Seed de 4 cards nuevas en Construcción (etapa Dimensionado)
--
-- Todas en Cali → zona Sur. Con dimensionamiento completo (kWp, paneles,
-- baterías, marca, potencia) y las categorías del catálogo vinculadas para
-- que al pasar a Alistamiento la auto-reserva encuentre los seriales de la
-- Bodega Cali.
--
-- Casas:
--   1. LLANOS DE PANCE #73    — JAVID SALAZAR       — Livoltek 15k + 2 bat + 6 paneles
--   2. PARAÍSO CJ II #19       — ORIANA CARVAJAL     — Deye 15k + 3 bat + 8 paneles
--   3. PANCE CAMPESTRE #48    — ANDRÉS PRECIADO     — Deye 6k + 8 bat + 19 paneles
--   4. PARAÍSO CJ II #20       — MARIA F. BLANCO     — Deye 15k + 2 bat + 6 paneles
-- ─────────────────────────────────────────────────────────────────

begin;

insert into crm_projects (
  title, current_module, sales_stage, engineering_stage, operations_stage,
  client_name, client_city, client_address, client_doc_type, client_doc_number,
  estrato, conjunto, casa_numero, carga_carro_electrico,
  invoice_kwh_mensual, autosuficiencia_objetivo_pct, zona,
  diseno_kwp, diseno_paneles,
  diseno_baterias_cantidad, diseno_bateria_capacidad_kwh,
  diseno_inversor_marca, diseno_inversor_potencia_kw,
  diseno_bateria_marca,
  diseno_inversor_categoria_id,
  diseno_bateria_categoria_id,
  diseno_panel_categoria_id,
  diseno_aprobado_por, diseno_aprobado_at,
  created_by, assigned_to, notes
)
select
  v.title, 'operations', 'completado', 'completado', 'dimensionado',
  v.client_name, 'Cali', v.client_address, 'CC', v.client_doc_number,
  v.estrato, v.conjunto, v.casa_numero, 'No tenemos carro eléctrico',
  v.consumo, v.autosuf, 'Sur',
  v.kwp, v.paneles,
  v.bat_cant, v.bat_kwh_unit,
  v.marca_inv, v.pot_inv_kw,
  v.marca_bat,
  (select id from inventory_categories where code = v.inv_code),
  (select id from inventory_categories where code = v.bat_code),
  (select id from inventory_categories where code = 'JASOLAR_PANEL_595W'),
  v.responsable, now(),
  'seed-mig-42', v.responsable, v.notas
from (values
  -- Card 1: LLANOS DE PANCE #73
  ('LLANOS DE PANCE-73 (JAVID SALAZAR ESPINOSA-94371058)',
    'JAVID SALAZAR ESPINOSA', null::text, '94371058', 6::integer, 'CONDOMINIO LLANOS DE PANCE', '73',
    427::numeric, 90::numeric,
    3.57::numeric, 6::integer,
    2::integer, 5.10::numeric, 'Livoltek', 15::numeric, 'Livoltek',
    'LIVOLTEK_INV_15KW', 'LIVOLTEK_BAT_HV',
    'Andres Herrera',
    'Consumo 427 kWh/mes · Autosuf 90% (384 kWh) · Paneles JA Solar 595W · Inversor Livoltek 15k · 2 baterías Livoltek HV'
  ),
  -- Card 2: PARAÍSO CJ II #19
  ('PARAÍSO DE CIUDAD JARDÍN II-19 (ORIANA CARVAJAL-66993384)',
    'ORIANA CARVAJAL', 'Calle 22 110-120', '66993384', 6, 'PARAÍSO DE CIUDAD JARDÍN II', '19',
    532, 90,
    4.76, 8,
    3, 4.09, 'DEYE', 15, 'DEYE',
    'DEYE_INV_15KW_HV', 'DEYE_BAT_HV_4KWH',
    'Santiago Andres Osorio Huertas',
    'Consumo 532 kWh/mes · Autosuf 90% (478.80 kWh) · Paneles JA Solar 595W · Inversor Deye 15k · 3 baterías Deye HV'
  ),
  -- Card 3: PANCE CAMPESTRE #48 (sin estrato)
  ('PANCE CAMPESTRE-48 (ANDRÉS AUGUSTO PRECIADO GIL-94531972)',
    'ANDRÉS AUGUSTO PRECIADO GIL', null, '94531972', null, 'CONDOMINIO PANCE CAMPESTRE', '48',
    1389, null,
    11.305, 19,
    8, 4.09, 'DEYE', 6, 'DEYE',
    'DEYE_INV_6KW_LV', 'DEYE_BAT_HV_4KWH',
    'David Esteban Rodriguez',
    'Consumo 1389 kWh/mes · Paneles JA Solar 595W · Inversor Deye 6k · 8 baterías Deye HV'
  ),
  -- Card 4: PARAÍSO CJ II #20
  ('PARAÍSO DE CIUDAD JARDÍN II-20 (MARIA FERNANDA BLANCO-31976388)',
    'MARIA FERNANDA BLANCO', 'Calle 22 110-120 casa 20', '31976388', 6, 'PARAÍSO DE CIUDAD JARDÍN II', '20',
    372, 90,
    3.57, 6,
    2, 4.09, 'DEYE', 15, 'DEYE',
    'DEYE_INV_15KW_HV', 'DEYE_BAT_HV_4KWH',
    'Santiago Andres Osorio Huertas',
    'Consumo 372 kWh/mes · Autosuf 90% (334.80 kWh) · Paneles JA Solar 595W · Inversor Deye 15k · 2 baterías Deye HV'
  )
) as v(
  title, client_name, client_address, client_doc_number, estrato, conjunto, casa_numero,
  consumo, autosuf,
  kwp, paneles,
  bat_cant, bat_kwh_unit, marca_inv, pot_inv_kw, marca_bat,
  inv_code, bat_code,
  responsable, notas
);

-- Evento 'created' para cada proyecto (audit log del CRM)
insert into crm_project_events (project_id, event_type, to_module, to_stage, actor_email, notes)
select p.id, 'created', 'operations', 'dimensionado', 'seed-mig-42',
       'Card creada vía seed (mig 42) — Dimensionado inicial'
from crm_projects p
where p.created_by = 'seed-mig-42';

commit;

-- Verificación:
-- select code, title, client_name, conjunto, casa_numero, diseno_paneles, diseno_kwp,
--        diseno_inversor_marca, diseno_baterias_cantidad, operations_stage
--   from crm_projects
--  where created_by = 'seed-mig-42'
--  order by created_at;
