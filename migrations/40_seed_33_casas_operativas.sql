-- ─────────────────────────────────────────────────────────────────
-- Phase 40 — Carga masiva de 33 casas operativas
--
-- Contenido:
--   1. 3 nuevas categorías de inventario (medidor solar, medidor generación, módem)
--   2. 33 client_houses (placeholder cliente_id 'PEND-<conjunto>-<casa>')
--   3. 33 crm_projects en etapa 'operativo' con dimensionado + operador de red
--   4. 33 facturacion_records con capex y costos por componente
--   5. ~554 inventory_items con status='installed', vinculados a la casa:
--        • 290 paneles JA Solar 595w
--        • 33 inversores (10 Deye 15k · 1 Deye 6k · 17 Livoltek 10k · 5 Livoltek 15k)
--        • 97 baterías (36 Deye HV · 58 Livoltek HV · 3 Pylontech)
--        • 33 BMS (10 Deye · 22 Livoltek · 1 Pylontech)
--        • 2 Top Cover (Livoltek — solo Los Abedules y Terra by Kaia)
--        • 33 medidores solares + 33 medidores generación + 33 módems
--
-- IMPORTANTE: Este script AGREGA inventario nuevo — NO toca los consumables
-- existentes de la migración 36. Los items nuevos van directos con
-- status='installed' y quedan asociados a su casa vía current_house_id.
--
-- Serial: INST-<conj-slug>-<casa>-<tipo>-<n>
-- ─────────────────────────────────────────────────────────────────

begin;

-- ───────────────────────────────────────────────────────
-- 1. Nuevas categorías (medidor solar, medidor generación, módem)
-- ───────────────────────────────────────────────────────
insert into inventory_categories (code, name, family, description, default_brand, default_capacity_unit, default_warranty_months, is_serialized)
values
  ('METER_SOLAR', 'Medidor Solar',      'meter', 'Medidor de generación solar en punto común de conexión',       null, null, 60, true),
  ('METER_GEN',   'Medidor Generación', 'meter', 'Medidor de energía generada (contador dedicado del inversor)', null, null, 60, true),
  ('MODEM',       'Módem',              'gateway', 'Módem de conectividad para telemetría del sistema',           null, null, 24, true)
on conflict (code) do nothing;

-- ───────────────────────────────────────────────────────
-- 2. Client houses (33) — cliente_id placeholder hasta sync con Metrum
-- ───────────────────────────────────────────────────────
with new_houses(cliente_id, casa, location, city) as (values
  ('PEND-RDP-2',   'Casa 2',   'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-56',  'Casa 56',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-42',  'Casa 42',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-104', 'Casa 104', 'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-77',  'Casa 77',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-30',  'Casa 30',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-10',  'Casa 10',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-76',  'Casa 76',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-15',  'Casa 15',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-111', 'Casa 111', 'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-70',  'Casa 70',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-11',  'Casa 11',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-57',  'Casa 57',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-23',  'Casa 23',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-63',  'Casa 63',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-18',  'Casa 18',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-74',  'Casa 74',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-99',  'Casa 99',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-108', 'Casa 108', 'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-48',  'Casa 48',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-29',  'Casa 29',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-RDP-35',  'Casa 35',  'RESERVA DE PANCE', 'Cali'),
  ('PEND-LAB-12',  'Casa 12',  'LOS ABEDULES',     'Cali'),
  ('PEND-TBK-24',  'Casa 24',  'TERRA BY KAIA',    'Barranquilla'),
  ('PEND-PRI-23',  'Casa 23',  'PRIMAVERA',        'Turbaco'),
  ('PEND-PRI-18A', 'Casa 18A', 'PRIMAVERA',        'Turbaco'),
  ('PEND-PRI-93',  'Casa 93',  'PRIMAVERA',        'Turbaco'),
  ('PEND-PRI-102', 'Casa 102', 'PRIMAVERA',        'Turbaco'),
  ('PEND-PRI-55',  'Casa 55',  'PRIMAVERA',        'Turbaco'),
  ('PEND-PRI-435', 'Casa 435', 'PRIMAVERA',        'Turbaco'),
  ('PEND-PRI-446', 'Casa 446', 'PRIMAVERA',        'Turbaco'),
  ('PEND-PRI-382', 'Casa 382', 'PRIMAVERA',        'Turbaco'),
  ('PEND-TBK-287', 'Casa 287', 'TERRA BY KAIA',    'Barranquilla')
)
insert into client_houses (cliente_id, casa, location, city)
select cliente_id, casa, location, city from new_houses
on conflict (cliente_id) do nothing;

-- ───────────────────────────────────────────────────────
-- 3. crm_projects (33) en etapa operativo
-- ───────────────────────────────────────────────────────
with proj_data(cliente_id, title, zona, ciudad, conjunto, casa_n, fecha,
               paneles, kwp, bat_cant, kwh, kwh_unit, marca_inv, marca_bat, or_red, sol, plan) as (values
  ('PEND-RDP-2',   'Reserva de Pance — Casa 2',   'Sur',   'Cali', 'RESERVA DE PANCE', '2',   date '2025-10-18', 12, 7.14, 4, 16.36, 4.09, 'Deye 15k',     'Deye HV',   'EMCALI',  'Sol.3', '7K'),
  ('PEND-RDP-56',  'Reserva de Pance — Casa 56',  'Sur',   'Cali', 'RESERVA DE PANCE', '56',  date '2025-10-24',  7, 4.17, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-42',  'Reserva de Pance — Casa 42',  'Sur',   'Cali', 'RESERVA DE PANCE', '42',  date '2025-10-30',  7, 4.17, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-104', 'Reserva de Pance — Casa 104', 'Sur',   'Cali', 'RESERVA DE PANCE', '104', date '2025-10-28',  7, 4.17, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-77',  'Reserva de Pance — Casa 77',  'Sur',   'Cali', 'RESERVA DE PANCE', '77',  date '2025-11-04',  7, 4.17, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-30',  'Reserva de Pance — Casa 30',  'Sur',   'Cali', 'RESERVA DE PANCE', '30',  date '2025-11-05',  7, 4.17, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-10',  'Reserva de Pance — Casa 10',  'Sur',   'Cali', 'RESERVA DE PANCE', '10',  date '2025-11-07', 12, 7.14, 4, 16.36, 4.09, 'Deye 15k',     'Deye HV',   'EMCALI',  'Sol.3', '7K'),
  ('PEND-RDP-76',  'Reserva de Pance — Casa 76',  'Sur',   'Cali', 'RESERVA DE PANCE', '76',  date '2025-12-19', 12, 7.14, 4, 20.40, 5.10, 'Livoltek 15k', 'Livoltek',  'EMCALI',  'Sol.3', '7K'),
  ('PEND-RDP-15',  'Reserva de Pance — Casa 15',  'Sur',   'Cali', 'RESERVA DE PANCE', '15',  date '2026-02-05', 15, 8.93, 4, 20.40, 5.10, 'Livoltek 15k', 'Livoltek',  'EMCALI',  'Sol.4', '10K'),
  ('PEND-RDP-111', 'Reserva de Pance — Casa 111', 'Sur',   'Cali', 'RESERVA DE PANCE', '111', date '2025-12-19', 15, 8.93, 4, 16.36, 4.09, 'Deye 15k',     'Deye HV',   'EMCALI',  'Sol.4', '10K'),
  ('PEND-RDP-70',  'Reserva de Pance — Casa 70',  'Sur',   'Cali', 'RESERVA DE PANCE', '70',  date '2025-11-17',  9, 5.36, 3, 12.27, 4.09, 'Deye 15k',     'Deye HV',   'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-11',  'Reserva de Pance — Casa 11',  'Sur',   'Cali', 'RESERVA DE PANCE', '11',  date '2025-12-20',  7, 4.17, 2, 10.20, 5.10, 'Livoltek 15k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-57',  'Reserva de Pance — Casa 57',  'Sur',   'Cali', 'RESERVA DE PANCE', '57',  date '2025-12-16',  7, 4.17, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-23',  'Reserva de Pance — Casa 23',  'Sur',   'Cali', 'RESERVA DE PANCE', '23',  date '2025-12-03', 11, 6.55, 3, 15.30, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.3', '7K'),
  ('PEND-RDP-63',  'Reserva de Pance — Casa 63',  'Sur',   'Cali', 'RESERVA DE PANCE', '63',  date '2025-12-11',  6, 3.57, 3, 15.30, 5.10, 'Deye 6k',      'Pylontech', 'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-18',  'Reserva de Pance — Casa 18',  'Sur',   'Cali', 'RESERVA DE PANCE', '18',  date '2025-12-18',  7, 4.17, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-74',  'Reserva de Pance — Casa 74',  'Sur',   'Cali', 'RESERVA DE PANCE', '74',  date '2025-12-11',  9, 5.36, 4, 16.36, 4.09, 'Deye 15k',     'Deye HV',   'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-99',  'Reserva de Pance — Casa 99',  'Sur',   'Cali', 'RESERVA DE PANCE', '99',  date '2025-12-09',  9, 5.36, 3, 12.27, 4.09, 'Deye 15k',     'Deye HV',   'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-108', 'Reserva de Pance — Casa 108', 'Sur',   'Cali', 'RESERVA DE PANCE', '108', date '2025-12-13',  7, 4.17, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-48',  'Reserva de Pance — Casa 48',  'Sur',   'Cali', 'RESERVA DE PANCE', '48',  date '2025-12-18',  6, 3.57, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-29',  'Reserva de Pance — Casa 29',  'Sur',   'Cali', 'RESERVA DE PANCE', '29',  date '2025-12-12',  9, 5.36, 3, 15.30, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-RDP-35',  'Reserva de Pance — Casa 35',  'Sur',   'Cali', 'RESERVA DE PANCE', '35',  date '2026-02-10',  6, 3.57, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek',  'EMCALI',  'Sol.2', '3K'),
  ('PEND-LAB-12',  'Los Abedules — Casa 12',      'Sur',   'Cali', 'LOS ABEDULES',     '12',  date '2026-02-26', 22, 13.09, 6, 30.60, 5.10, 'Livoltek 15k', 'Livoltek',  'EMCALI',  'Sol.4', '13K'),
  ('PEND-TBK-24',  'Terra by Kaia — Casa 24',     'Norte', 'Barranquilla', 'TERRA BY KAIA', '24',  date '2026-04-29', 16, 9.52,  6, 30.60, 5.10, 'Livoltek 15k', 'Livoltek', 'AIRE',   'Sol.4', '10K'),
  ('PEND-PRI-23',  'Primavera — Casa 23',         'Norte', 'Turbaco', 'PRIMAVERA',        '23',  date '2026-05-15',  5, 2.98, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek', 'AFINIA', 'Sol.2', '3K'),
  ('PEND-PRI-18A', 'Primavera — Casa 18A',        'Norte', 'Turbaco', 'PRIMAVERA',        '18A', date '2026-05-14',  6, 3.57, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek', 'AFINIA', 'Sol.2', '3K'),
  ('PEND-PRI-93',  'Primavera — Casa 93',         'Norte', 'Turbaco', 'PRIMAVERA',        '93',  date '2026-05-27',  8, 4.76, 4, 16.36, 4.09, 'Deye 15k',     'Deye HV',  'AFINIA', 'Sol.2', '3K'),
  ('PEND-PRI-102', 'Primavera — Casa 102',        'Norte', 'Turbaco', 'PRIMAVERA',        '102', date '2026-05-29',  5, 2.98, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek', 'AFINIA', 'Sol.2', '3K'),
  ('PEND-PRI-55',  'Primavera — Casa 55',         'Norte', 'Turbaco', 'PRIMAVERA',        '55',  date '2026-06-02',  8, 4.76, 4, 16.36, 4.09, 'Deye 15k',     'Deye HV',  'AFINIA', 'Sol.2', '3K'),
  ('PEND-PRI-435', 'Primavera — Casa 435',        'Norte', 'Turbaco', 'PRIMAVERA',        '435', date '2026-06-05',  6, 3.57, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek', 'AFINIA', 'Sol.2', '3K'),
  ('PEND-PRI-446', 'Primavera — Casa 446',        'Norte', 'Turbaco', 'PRIMAVERA',        '446', date '2026-06-06',  7, 4.17, 3, 12.27, 4.09, 'Deye 15k',     'Deye HV',  'AFINIA', 'Sol.2', '3K'),
  ('PEND-PRI-382', 'Primavera — Casa 382',        'Norte', 'Turbaco', 'PRIMAVERA',        '382', date '2026-06-27',  8, 4.76, 3, 12.27, 4.09, 'Deye 15k',     'Deye HV',  'AFINIA', 'Sol.2', '3K'),
  ('PEND-TBK-287', 'Terra by Kaia — Casa 287',    'Norte', 'Barranquilla', 'TERRA BY KAIA', '287', date '2026-06-25',  5, 2.98, 2, 10.20, 5.10, 'Livoltek 10k', 'Livoltek', 'AIRE',  'Sol.2', '3K')
)
insert into crm_projects (
  title, current_module, sales_stage, engineering_stage, operations_stage,
  client_city, conjunto, casa_numero, zona,
  installation_date, operativo_at,
  diseno_paneles, diseno_kwp, diseno_baterias_cantidad, diseno_bateria_capacidad_kwh,
  diseno_inversor_marca, diseno_bateria_marca,
  contractor_name, agpe_operador_red,
  house_id, notes
)
select
  pd.title, 'operations', 'completado', 'completado', 'operativo',
  pd.ciudad, pd.conjunto, pd.casa_n, pd.zona,
  pd.fecha, pd.fecha::timestamptz,
  pd.paneles, pd.kwp, pd.bat_cant, pd.kwh_unit,
  pd.marca_inv, pd.marca_bat,
  'Estruccon', pd.or_red,
  h.id,
  pd.sol || ' · Plan ' || pd.plan || ' · JA Solar 595w'
from proj_data pd
join client_houses h on h.cliente_id = pd.cliente_id;

-- ───────────────────────────────────────────────────────
-- 4. Facturación (33 registros)
-- ───────────────────────────────────────────────────────
with fact_data(cliente_id, sol, plan, or_red,
               costo_inv, costo_bat, costo_bms, costo_top, costo_panel,
               costo_med_s, costo_med_g, costo_modem, mano_obra, desmant, capex) as (values
  ('PEND-RDP-2',   'Sol.3', '7K', 'EMCALI', 13840910, 22094640, 3943190,       0, 3367608, 504000, 504000, 972000, 7896840, 3158736, 53123188),
  ('PEND-RDP-56',  'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 26960063),
  ('PEND-RDP-42',  'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 26960063),
  ('PEND-RDP-104', 'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 26960063),
  ('PEND-RDP-77',  'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 26960063),
  ('PEND-RDP-30',  'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 26960063),
  ('PEND-RDP-10',  'Sol.3', '7K', 'EMCALI', 13840910, 22094640, 3943190,       0, 3367608, 504000, 504000, 972000, 7896840, 3158736, 53123188),
  ('PEND-RDP-76',  'Sol.3', '7K', 'EMCALI',  5567141, 18020417, 1747478,       0, 3367608, 504000, 504000, 972000, 7896840, 3158736, 38579484),
  ('PEND-RDP-15',  'Sol.4', '10K','EMCALI',  5567141, 18020417, 1747478,       0, 4209510, 504000, 504000, 972000, 8630475, 3452190, 40155021),
  ('PEND-RDP-111', 'Sol.4', '10K','EMCALI', 13840910, 22094640, 3943190,       0, 4209510, 504000, 504000, 972000, 8630475, 3452190, 54698725),
  ('PEND-RDP-70',  'Sol.2', '3K', 'EMCALI', 13840910, 16570980, 3943190,       0, 2525706, 504000, 504000, 972000, 9349830, 3739932, 48210616),
  ('PEND-RDP-11',  'Sol.2', '3K', 'EMCALI',  5567141,  9010209, 1747478,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 27541355),
  ('PEND-RDP-57',  'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 26960063),
  ('PEND-RDP-23',  'Sol.3', '7K', 'EMCALI',  4985849, 13515313, 1747478,       0, 3086974, 504000, 504000, 972000, 7238770, 2895508, 32554383),
  ('PEND-RDP-63',  'Sol.2', '3K', 'EMCALI',  9363184, 15536070, 2816695,       0, 1683804, 504000, 504000, 972000, 6233220, 2493288, 37612973),
  ('PEND-RDP-18',  'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 26960063),
  ('PEND-RDP-74',  'Sol.2', '3K', 'EMCALI', 13840910, 22094640, 3943190,       0, 2525706, 504000, 504000, 972000, 9349830, 3739932, 53734276),
  ('PEND-RDP-99',  'Sol.2', '3K', 'EMCALI', 13840910, 16570980, 3943190,       0, 2525706, 504000, 504000, 972000, 9349830, 3739932, 48210616),
  ('PEND-RDP-108', 'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 26960063),
  ('PEND-RDP-48',  'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1683804, 504000, 504000, 972000, 6233220, 2493288, 25640559),
  ('PEND-RDP-29',  'Sol.2', '3K', 'EMCALI',  4985849, 13515313, 1747478,       0, 2525706, 504000, 504000, 972000, 9349830, 3739932, 34104175),
  ('PEND-RDP-35',  'Sol.2', '3K', 'EMCALI',  4985849,  9010209, 1747478,       0, 1683804, 504000, 504000, 972000, 6233220, 2493288, 25640559),
  ('PEND-LAB-12',  'Sol.4', '13K','EMCALI',  5567141, 27030626, 1747478, 1747478, 6173948, 504000, 504000, 972000,12658030, 5063212, 56904700),
  ('PEND-TBK-24',  'Sol.4', '10K','AIRE',    5567141, 27030626, 1747478, 1747478, 4490144, 504000, 504000, 972000, 9205840, 3682336, 51768706),
  ('PEND-PRI-23',  'Sol.2', '3K', 'AFINIA',  4985849,  9010209, 1747478,       0, 1403170, 504000, 504000, 972000, 5194350, 2077740, 24321055),
  ('PEND-PRI-18A', 'Sol.2', '3K', 'AFINIA',  4985849,  9010209, 1747478,       0, 1683804, 504000, 504000, 972000, 6233220, 2493288, 25640559),
  ('PEND-PRI-93',  'Sol.2', '3K', 'AFINIA', 13840910, 22094640, 3943190,       0, 2245072, 504000, 504000, 972000, 8310960, 3324384, 52414772),
  ('PEND-PRI-102', 'Sol.2', '3K', 'AFINIA',  4985849,  9010209, 1747478,       0, 1403170, 504000, 504000, 972000, 5194350, 2077740, 24321055),
  ('PEND-PRI-55',  'Sol.2', '3K', 'AFINIA', 13840910, 22094640, 3943190,       0, 2245072, 504000, 504000, 972000, 8310960, 3324384, 52414772),
  ('PEND-PRI-435', 'Sol.2', '3K', 'AFINIA',  4985849,  9010209, 1747478,       0, 1683804, 504000, 504000, 972000, 6233220, 2493288, 25640559),
  ('PEND-PRI-446', 'Sol.2', '3K', 'AFINIA', 13840910, 16570980, 3943190,       0, 1964438, 504000, 504000, 972000, 7272090, 2908836, 45571608),
  ('PEND-PRI-382', 'Sol.2', '3K', 'AFINIA', 13840910, 16570980, 3943190,       0, 2245072, 504000, 504000, 972000, 8310960, 3324384, 46891112),
  ('PEND-TBK-287', 'Sol.2', '3K', 'AIRE',    4985849,  9010209, 1747478,       0, 1403170, 504000, 504000, 972000, 5194350, 2077740, 24321055)
)
insert into facturacion_records (
  project_id, solucion, plan, operador_red,
  costo_inversor, costo_bateria, costo_control_box, costo_top_cover, costo_panel_solar,
  costo_medidor_solar, costo_medidor_generacion, costo_modem, mano_de_obra, desmantelamiento_mo,
  capex, created_by
)
select
  p.id, fd.sol, fd.plan, fd.or_red,
  fd.costo_inv, fd.costo_bat, fd.costo_bms, fd.costo_top, fd.costo_panel,
  fd.costo_med_s, fd.costo_med_g, fd.costo_modem, fd.mano_obra, fd.desmant,
  fd.capex, 'seed-mig-40'
from fact_data fd
join client_houses h on h.cliente_id = fd.cliente_id
join crm_projects p on p.house_id = h.id
on conflict (project_id) do nothing;

-- ───────────────────────────────────────────────────────
-- 5. Inventory items (installed)
-- Cada INSERT lee directo de crm_projects/client_houses/facturacion_records
-- que ya se insertaron arriba. Sin tablas auxiliares intermedias.
-- Suffix slug de casa se deriva quitando 'PEND-' al cliente_id.
-- ───────────────────────────────────────────────────────

-- 5a. Panels (JA Solar 595w — 290 total)
-- Costo unitario = costo_panel_solar / diseno_paneles
insert into inventory_items (category_id, serial_number, brand, model, capacity_value, capacity_unit,
                             status, current_location, current_house_id,
                             acquired_at, acquired_cost_cop, warranty_months, warranty_expires_at, notes, created_by)
select
  (select id from inventory_categories where code = 'JASOLAR_PANEL_595W'),
  'INST-' || replace(h.cliente_id, 'PEND-', '') || '-PAN-' || lpad(n::text, 2, '0'),
  'JA Solar', 'JAM72D40-595/MB', 595, 'Wp',
  'installed', 'casa:' || h.location || ' - ' || h.casa, h.id,
  p.installation_date, (f.costo_panel_solar / nullif(p.diseno_paneles, 0))::numeric,
  120, (p.installation_date + interval '120 months')::date,
  'Instalado en ' || h.location || ' ' || h.casa, 'seed-mig-40'
from crm_projects p
join client_houses h on h.id = p.house_id
join facturacion_records f on f.project_id = p.id
cross join lateral generate_series(1, p.diseno_paneles) as n
where f.created_by = 'seed-mig-40';

-- 5b. Inversores (33) — mapeo marca → category code
insert into inventory_items (category_id, serial_number, brand, model, capacity_value, capacity_unit,
                             status, current_location, current_house_id,
                             acquired_at, acquired_cost_cop, warranty_months, warranty_expires_at, notes, created_by)
select
  cat.id,
  'INST-' || replace(h.cliente_id, 'PEND-', '') || '-INV',
  cat.default_brand, cat.default_model, cat.default_capacity_value, cat.default_capacity_unit,
  'installed', 'casa:' || h.location || ' - ' || h.casa, h.id,
  p.installation_date, f.costo_inversor, 120, (p.installation_date + interval '120 months')::date,
  'Inversor ' || p.diseno_inversor_marca, 'seed-mig-40'
from crm_projects p
join client_houses h on h.id = p.house_id
join facturacion_records f on f.project_id = p.id
join inventory_categories cat on cat.code = case p.diseno_inversor_marca
    when 'Deye 15k'     then 'DEYE_INV_15KW_HV'
    when 'Deye 6k'      then 'DEYE_INV_6KW_LV'
    when 'Livoltek 10k' then 'LIVOLTEK_INV_10KW'
    when 'Livoltek 15k' then 'LIVOLTEK_INV_15KW'
  end
where f.created_by = 'seed-mig-40';

-- 5c. Baterías (97 total) — expandir por cantidad
-- Costo unitario = costo_bateria / diseno_baterias_cantidad
insert into inventory_items (category_id, serial_number, brand, model, capacity_value, capacity_unit,
                             status, current_location, current_house_id,
                             acquired_at, acquired_cost_cop, warranty_months, warranty_expires_at, notes, created_by)
select
  cat.id,
  'INST-' || replace(h.cliente_id, 'PEND-', '') || '-BAT-' || lpad(n::text, 2, '0'),
  cat.default_brand, cat.default_model, p.diseno_bateria_capacidad_kwh, 'kWh',
  'installed', 'casa:' || h.location || ' - ' || h.casa, h.id,
  p.installation_date, (f.costo_bateria / nullif(p.diseno_baterias_cantidad, 0))::numeric,
  120, (p.installation_date + interval '120 months')::date,
  'Batería ' || p.diseno_bateria_marca || ' (' || p.diseno_bateria_capacidad_kwh || ' kWh)', 'seed-mig-40'
from crm_projects p
join client_houses h on h.id = p.house_id
join facturacion_records f on f.project_id = p.id
join inventory_categories cat on cat.code = case p.diseno_bateria_marca
    when 'Deye HV'   then 'DEYE_BAT_HV_4KWH'
    when 'Livoltek'  then 'LIVOLTEK_BAT_HV'
    when 'Pylontech' then 'PYLONTECH_BAT_LV'
  end
cross join lateral generate_series(1, p.diseno_baterias_cantidad) as n
where f.created_by = 'seed-mig-40';

-- 5d. BMS (33) — uno por casa, marca según batería
insert into inventory_items (category_id, serial_number, brand, model,
                             status, current_location, current_house_id,
                             acquired_at, acquired_cost_cop, warranty_months, warranty_expires_at, notes, created_by)
select
  cat.id,
  'INST-' || replace(h.cliente_id, 'PEND-', '') || '-BMS',
  cat.default_brand, cat.default_model,
  'installed', 'casa:' || h.location || ' - ' || h.casa, h.id,
  p.installation_date, f.costo_control_box, 120, (p.installation_date + interval '120 months')::date,
  'BMS ' || p.diseno_bateria_marca, 'seed-mig-40'
from crm_projects p
join client_houses h on h.id = p.house_id
join facturacion_records f on f.project_id = p.id
join inventory_categories cat on cat.code = case p.diseno_bateria_marca
    when 'Deye HV'   then 'DEYE_BMS'
    when 'Livoltek'  then 'LIVOLTEK_BMS'
    when 'Pylontech' then 'PYLONTECH_BMS'
  end
where f.created_by = 'seed-mig-40';

-- 5e. Top Covers (solo casas con costo_top_cover > 0 → LAB-12 y TBK-24)
insert into inventory_items (category_id, serial_number, brand, model,
                             status, current_location, current_house_id,
                             acquired_at, acquired_cost_cop, warranty_months, warranty_expires_at, notes, created_by)
select
  (select id from inventory_categories where code = 'LIVOLTEK_TOP_COVER'),
  'INST-' || replace(h.cliente_id, 'PEND-', '') || '-TOP',
  'Livoltek', 'BHO-20500N',
  'installed', 'casa:' || h.location || ' - ' || h.casa, h.id,
  p.installation_date, f.costo_top_cover, 120, (p.installation_date + interval '120 months')::date,
  'Top Cover Livoltek', 'seed-mig-40'
from crm_projects p
join client_houses h on h.id = p.house_id
join facturacion_records f on f.project_id = p.id
where f.created_by = 'seed-mig-40'
  and coalesce(f.costo_top_cover, 0) > 0;

-- 5f. Medidores solares (33)
insert into inventory_items (category_id, serial_number,
                             status, current_location, current_house_id,
                             acquired_at, acquired_cost_cop, warranty_months, warranty_expires_at, notes, created_by)
select
  (select id from inventory_categories where code = 'METER_SOLAR'),
  'INST-' || replace(h.cliente_id, 'PEND-', '') || '-MDS',
  'installed', 'casa:' || h.location || ' - ' || h.casa, h.id,
  p.installation_date, f.costo_medidor_solar, 60, (p.installation_date + interval '60 months')::date,
  'Medidor Solar', 'seed-mig-40'
from crm_projects p
join client_houses h on h.id = p.house_id
join facturacion_records f on f.project_id = p.id
where f.created_by = 'seed-mig-40';

-- 5g. Medidores de generación (33)
insert into inventory_items (category_id, serial_number,
                             status, current_location, current_house_id,
                             acquired_at, acquired_cost_cop, warranty_months, warranty_expires_at, notes, created_by)
select
  (select id from inventory_categories where code = 'METER_GEN'),
  'INST-' || replace(h.cliente_id, 'PEND-', '') || '-MDG',
  'installed', 'casa:' || h.location || ' - ' || h.casa, h.id,
  p.installation_date, f.costo_medidor_generacion, 60, (p.installation_date + interval '60 months')::date,
  'Medidor Generación', 'seed-mig-40'
from crm_projects p
join client_houses h on h.id = p.house_id
join facturacion_records f on f.project_id = p.id
where f.created_by = 'seed-mig-40';

-- 5h. Módems (33)
insert into inventory_items (category_id, serial_number,
                             status, current_location, current_house_id,
                             acquired_at, acquired_cost_cop, warranty_months, warranty_expires_at, notes, created_by)
select
  (select id from inventory_categories where code = 'MODEM'),
  'INST-' || replace(h.cliente_id, 'PEND-', '') || '-MOD',
  'installed', 'casa:' || h.location || ' - ' || h.casa, h.id,
  p.installation_date, f.costo_modem, 24, (p.installation_date + interval '24 months')::date,
  'Módem de conectividad', 'seed-mig-40'
from crm_projects p
join client_houses h on h.id = p.house_id
join facturacion_records f on f.project_id = p.id
where f.created_by = 'seed-mig-40';

-- ───────────────────────────────────────────────────────
-- 6. Audit trail: evento 'created' por cada proyecto insertado
-- ───────────────────────────────────────────────────────
insert into crm_project_events (project_id, event_type, to_module, to_stage, actor_email, notes)
select p.id, 'created', 'operations', 'operativo', 'seed-mig-40', 'Seed masivo (mig 40) — 33 casas operativas'
from crm_projects p
where p.created_by is null and p.notes like '%JA Solar 595w%';

commit;

-- ───── Verificación ─────
-- select
--   (select count(*) from client_houses where cliente_id like 'PEND-%')     as casas,
--   (select count(*) from crm_projects where notes like '%JA Solar 595w%')  as proyectos,
--   (select count(*) from facturacion_records where created_by='seed-mig-40') as facturaciones,
--   (select count(*) from inventory_items where created_by='seed-mig-40')   as items;
-- Esperado: 33 · 33 · 33 · 554
