-- ─────────────────────────────────────────────────────────────────
-- Phase 46 — CAPEX venta + USD/Wp por casa en facturacion_records
--
-- Mig 40 sembró facturacion_records con costo por componente + capex (COSTO).
-- Faltaba:
--   - capex_venta: precio al cliente (Capex Venta del CSV)
--   - usd_wp:      métrica USD/Wp calculada con TRM del cierre del CSV
--                  (~4675 COP/USD implícita en la relación capex_venta / kWp / usd_wp)
--
-- La TRM operativa vigente es 3901.29 COP/USD, pero los valores del CSV
-- ya vienen calculados con la TRM del cierre — se guardan tal cual para
-- respetar el cierre contable de cada casa.
-- ─────────────────────────────────────────────────────────────────

begin;

alter table facturacion_records
  add column if not exists capex_venta numeric,
  add column if not exists usd_wp      numeric;

-- Populate para las 33 casas de mig 40 usando notes del proyecto
-- (que empieza con "Sol.X · Plan YK · JA Solar 595w") como discriminador.
-- Sin embargo mejor uso conjunto+casa_numero — más robusto.
with seed(conjunto, casa_numero, capex_venta, usd_wp) as (values
  ('RESERVA DE PANCE',   '2',   63747826::numeric, 1.91::numeric),
  ('RESERVA DE PANCE',   '56',  32352075::numeric, 1.66::numeric),
  ('RESERVA DE PANCE',   '42',  32352075::numeric, 1.66::numeric),
  ('RESERVA DE PANCE',   '104', 32352075::numeric, 1.66::numeric),
  ('RESERVA DE PANCE',   '77',  32352075::numeric, 1.66::numeric),
  ('RESERVA DE PANCE',   '30',  32352075::numeric, 1.66::numeric),
  ('RESERVA DE PANCE',   '10',  63747826::numeric, 1.91::numeric),
  ('RESERVA DE PANCE',   '76',  46295381::numeric, 1.39::numeric),
  ('RESERVA DE PANCE',   '15',  48186025::numeric, 1.15::numeric),
  ('RESERVA DE PANCE',   '111', 65638470::numeric, 1.57::numeric),
  ('RESERVA DE PANCE',   '70',  57852739::numeric, 2.31::numeric),
  ('RESERVA DE PANCE',   '11',  33049626::numeric, 1.69::numeric),
  ('RESERVA DE PANCE',   '57',  32352075::numeric, 1.66::numeric),
  ('RESERVA DE PANCE',   '23',  39065260::numeric, 1.27::numeric),
  ('RESERVA DE PANCE',   '63',  45135568::numeric, 2.70::numeric),
  ('RESERVA DE PANCE',   '18',  32352075::numeric, 1.66::numeric),
  ('RESERVA DE PANCE',   '74',  64481131::numeric, 2.57::numeric),
  ('RESERVA DE PANCE',   '99',  57852739::numeric, 2.31::numeric),
  ('RESERVA DE PANCE',   '108', 32352075::numeric, 1.66::numeric),
  ('RESERVA DE PANCE',   '48',  30768671::numeric, 1.84::numeric),
  ('RESERVA DE PANCE',   '29',  40925010::numeric, 1.63::numeric),
  ('RESERVA DE PANCE',   '35',  30768671::numeric, 1.84::numeric),
  ('LOS ABEDULES',       '12',  68285640::numeric, 1.11::numeric),
  ('TERRA BY KAIA',      '24',  62122447::numeric, 1.39::numeric),
  ('PRIMAVERA',          '23',  29185266::numeric, 2.10::numeric),
  ('PRIMAVERA',          '18A', 30768671::numeric, 1.84::numeric),
  ('PRIMAVERA',          '93',  62897726::numeric, 2.82::numeric),
  ('PRIMAVERA',          '102', 29185266::numeric, 2.10::numeric),
  ('PRIMAVERA',          '55',  62897726::numeric, 2.82::numeric),
  ('PRIMAVERA',          '435', 30768671::numeric, 1.84::numeric),
  ('PRIMAVERA',          '446', 54685930::numeric, 2.80::numeric),
  ('PRIMAVERA',          '382', 56269334::numeric, 2.53::numeric),
  ('TERRA BY KAIA',      '287', 29185266::numeric, 2.10::numeric)
)
update facturacion_records f
   set capex_venta = s.capex_venta,
       usd_wp      = s.usd_wp
  from seed s, crm_projects p
 where p.conjunto = s.conjunto
   and p.casa_numero = s.casa_numero
   and f.project_id = p.id;

commit;

-- Verificación:
-- select count(*) filter (where capex_venta is not null) as venta_ok,
--        count(*) filter (where usd_wp is not null)      as usd_ok,
--        avg(usd_wp)                                      as usd_wp_promedio
--   from facturacion_records
--  where created_by = 'seed-mig-40';
-- Esperado: 33 · 33 · ~1.90
