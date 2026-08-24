-- ─────────────────────────────────────────────────────────────────
-- Phase 67 — Limpieza de 554 items "fantasma" dejados por la migración
-- 40 (seed_33_casas_operativas): quedaron con status='in_stock',
-- created_by='seed-mig-40', sin warehouse_id ni current_house_id.
--
-- Se encontraron 2 patrones distintos al cruzar por categoría contra
-- lo que ya estaba en status='installed':
--
--   A) Duplicados exactos (batería/inversor/panel) — el mismo equipo ya
--      tenía su registro real 'installed' en otro lado; el fantasma solo
--      inflaba el conteo de "en stock". Se BORRARON (420 filas).
--
--   B) Único rastro existente (BMS Livoltek/Deye/Pylontech, Medidor
--      Solar/Generación, Módem, Top Cover Livoltek) — nunca tuvieron un
--      registro 'installed' real; estos fantasmas eran la única
--      evidencia de que ese equipo existía. Se RECLASIFICARON a
--      status='installed' vinculándolos a la casa real por
--      fecha de compra (acquired_at = crm_projects.installation_date)
--      + marca (para BMS, vía la categoría de batería de diseño de
--      cada proyecto) — 134 filas: 33 BMS + 33 Medidor Solar +
--      33 Medidor Generación + 33 Módem + 2 Top Cover.
--
-- Resultado: in_stock 1039→485, installed 446→580. Aplicado en vivo
-- por sesión de Claude (ver conversación) — este archivo documenta el
-- SQL ya ejecutado, no hace falta volver a correrlo.
-- ─────────────────────────────────────────────────────────────────

-- A) Duplicados — borrados
delete from inventory_items
where status = 'in_stock' and created_by = 'seed-mig-40' and warehouse_id is null
  and category_id in (select id from inventory_categories where family in ('battery','inverter','panel'));

-- B1) BMS — reclasificados por marca + fecha
with house_brand as (
  select p.house_id, p.installation_date, bc.default_brand
  from crm_projects p
  join inventory_categories bc on bc.id = p.diseno_bateria_categoria_id
  where p.house_id is not null and p.installation_date is not null and bc.family = 'battery'
),
ranked_houses as (
  select house_id, installation_date, default_brand,
    row_number() over (partition by default_brand, installation_date order by house_id) as rn
  from house_brand
),
ranked_fantasma as (
  select ii.id, ic.default_brand, ii.acquired_at,
    row_number() over (partition by ic.default_brand, ii.acquired_at order by ii.id) as rn
  from inventory_items ii
  join inventory_categories ic on ic.id = ii.category_id
  where ii.status = 'in_stock' and ii.created_by = 'seed-mig-40' and ii.warehouse_id is null and ic.family = 'bms'
)
update inventory_items ii
set status = 'installed', current_house_id = rh.house_id, current_location = 'house'
from ranked_fantasma rf
join ranked_houses rh on rh.default_brand = rf.default_brand and rh.installation_date = rf.acquired_at and rh.rn = rf.rn
where ii.id = rf.id;

-- B2) Medidor Solar / Medidor Generación / Módem — 1 por casa, sin importar marca
with ranked_houses_any as (
  select house_id, installation_date,
    row_number() over (partition by installation_date order by house_id) as rn
  from crm_projects
  where house_id is not null and installation_date is not null
),
ranked_fantasma as (
  select ii.id, ii.category_id, ii.acquired_at,
    row_number() over (partition by ii.category_id, ii.acquired_at order by ii.id) as rn
  from inventory_items ii
  where ii.status = 'in_stock' and ii.created_by = 'seed-mig-40' and ii.warehouse_id is null
    and ii.category_id in (select id from inventory_categories where code in ('METER_SOLAR','METER_GEN','MODEM'))
)
update inventory_items ii
set status = 'installed', current_house_id = rh.house_id, current_location = 'house'
from ranked_fantasma rf
join ranked_houses_any rh on rh.installation_date = rf.acquired_at and rh.rn = rf.rn
where ii.id = rf.id;

-- B3) Top Cover Livoltek — solo Kit 4C (15kW + 6 baterías), 2 casas
with ranked_houses_any as (
  select house_id, installation_date,
    row_number() over (partition by installation_date order by house_id) as rn
  from crm_projects
  where house_id is not null and installation_date is not null
),
ranked_fantasma as (
  select ii.id, ii.acquired_at,
    row_number() over (partition by ii.acquired_at order by ii.id) as rn
  from inventory_items ii
  where ii.status = 'in_stock' and ii.created_by = 'seed-mig-40' and ii.warehouse_id is null
    and ii.category_id = (select id from inventory_categories where code = 'LIVOLTEK_TOP_COVER')
)
update inventory_items ii
set status = 'installed', current_house_id = rh.house_id, current_location = 'house'
from ranked_fantasma rf
join ranked_houses_any rh on rh.installation_date = rf.acquired_at and rh.rn = rf.rn
where ii.id = rf.id;
