-- ─────────────────────────────────────────────────────────────────
-- Phase 64 — Corrige el match roto de mig 46 (capex_venta / usd_wp)
--
-- Mig 46 buscaba `p.conjunto = 'RESERVA DE PANCE'` / `'PRIMAVERA'` /
-- `'LOS ABEDULES'` exacto — pero los conjunto reales en crm_projects son
-- "CONDOMINIO RESERVA DE PANCE", "PRADO VERDE PRIMAVERA" (mayúsc./minúsc.
-- mixtas) y "CONDOMINIO LOS ABEDULES". Por eso el UPDATE solo pegó en 2 de
-- 33 filas (las 2 de "TERRA BY KAIA", que sí matcheaba exacto) — el Dash
-- mostraba solo 2 cards de "USD/Wp por solución" en vez de las ~33 reales.
-- Mismo seed de datos que mig 46, con match por casa_numero + conjunto
-- ILIKE (insensible a mayúsculas/prefijo "CONDOMINIO").
-- ─────────────────────────────────────────────────────────────────

with seed(conjunto_like, casa_numero, capex_venta, usd_wp) as (values
  ('%RESERVA DE PANCE%',   '2',   63747826::numeric, 1.91::numeric),
  ('%RESERVA DE PANCE%',   '56',  32352075::numeric, 1.66::numeric),
  ('%RESERVA DE PANCE%',   '42',  32352075::numeric, 1.66::numeric),
  ('%RESERVA DE PANCE%',   '104', 32352075::numeric, 1.66::numeric),
  ('%RESERVA DE PANCE%',   '77',  32352075::numeric, 1.66::numeric),
  ('%RESERVA DE PANCE%',   '30',  32352075::numeric, 1.66::numeric),
  ('%RESERVA DE PANCE%',   '10',  63747826::numeric, 1.91::numeric),
  ('%RESERVA DE PANCE%',   '76',  46295381::numeric, 1.39::numeric),
  ('%RESERVA DE PANCE%',   '15',  48186025::numeric, 1.15::numeric),
  ('%RESERVA DE PANCE%',   '111', 65638470::numeric, 1.57::numeric),
  ('%RESERVA DE PANCE%',   '70',  57852739::numeric, 2.31::numeric),
  ('%RESERVA DE PANCE%',   '11',  33049626::numeric, 1.69::numeric),
  ('%RESERVA DE PANCE%',   '57',  32352075::numeric, 1.66::numeric),
  ('%RESERVA DE PANCE%',   '23',  39065260::numeric, 1.27::numeric),
  ('%RESERVA DE PANCE%',   '63',  45135568::numeric, 2.70::numeric),
  ('%RESERVA DE PANCE%',   '18',  32352075::numeric, 1.66::numeric),
  ('%RESERVA DE PANCE%',   '74',  64481131::numeric, 2.57::numeric),
  ('%RESERVA DE PANCE%',   '99',  57852739::numeric, 2.31::numeric),
  ('%RESERVA DE PANCE%',   '108', 32352075::numeric, 1.66::numeric),
  ('%RESERVA DE PANCE%',   '48',  30768671::numeric, 1.84::numeric),
  ('%RESERVA DE PANCE%',   '29',  40925010::numeric, 1.63::numeric),
  ('%RESERVA DE PANCE%',   '35',  30768671::numeric, 1.84::numeric),
  ('%LOS ABEDULES%',       '12',  68285640::numeric, 1.11::numeric),
  ('%TERRA BY KAIA%',      '24',  62122447::numeric, 1.39::numeric),
  ('%PRIMAVERA%',          '23',  29185266::numeric, 2.10::numeric),
  ('%PRIMAVERA%',          '18A', 30768671::numeric, 1.84::numeric),
  ('%PRIMAVERA%',          '93',  62897726::numeric, 2.82::numeric),
  ('%PRIMAVERA%',          '102', 29185266::numeric, 2.10::numeric),
  ('%PRIMAVERA%',          '55',  62897726::numeric, 2.82::numeric),
  ('%PRIMAVERA%',          '435', 30768671::numeric, 1.84::numeric),
  ('%PRIMAVERA%',          '446', 54685930::numeric, 2.80::numeric),
  ('%PRIMAVERA%',          '382', 56269334::numeric, 2.53::numeric),
  ('%TERRA BY KAIA%',      '287', 29185266::numeric, 2.10::numeric)
)
update facturacion_records f
   set capex_venta = s.capex_venta,
       usd_wp      = s.usd_wp
  from seed s, crm_projects p
 where p.conjunto ilike s.conjunto_like
   and p.casa_numero = s.casa_numero
   and f.project_id = p.id;

-- 2 filas quedaron sin matchear incluso con el ILIKE de conjunto: su
-- casa_numero está guardado como "CASA 23"/"CASA 18A" (con prefijo) en vez
-- de "23"/"18A" — se aplican sueltas.
update facturacion_records f
set capex_venta = 29185266, usd_wp = 2.10
from crm_projects p
where f.project_id = p.id and p.conjunto ilike '%PRIMAVERA%' and p.casa_numero = 'CASA 23';

update facturacion_records f
set capex_venta = 30768671, usd_wp = 1.84
from crm_projects p
where f.project_id = p.id and p.conjunto ilike '%PRIMAVERA%' and p.casa_numero = 'CASA 18A';

-- Resultado esperado: 33 de 36 facturacion_records con usd_wp/capex_venta
-- (las 3 restantes — Terranova-78, Portón-18, Terra by Kaia-155 — nunca
-- estuvieron en el seed original de 33 casas, quedan null correctamente).
