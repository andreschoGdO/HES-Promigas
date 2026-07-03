-- ─────────────────────────────────────────────────────────────────
-- Phase 43 — Completar datos de las 33 casas operativas de mig 40
--
-- Dos correcciones:
--   1. Zona: mig 40 usó Norte/Interior/Sur. La nomenclatura correcta según
--      el CSV de operaciones es Valle (Cali) y Costa (Barranquilla/Turbaco).
--   2. Categorías FK: mig 40 solo llenó texto libre en diseno_inversor_marca /
--      diseno_bateria_marca. Faltaba vincular al catálogo (inventory_categories)
--      vía diseno_inversor_categoria_id, diseno_bateria_categoria_id y
--      diseno_panel_categoria_id — de ahí que en el Dash apareciera 'Sin marca'.
--
-- También extiende el check constraint de zona para aceptar los valores nuevos.
-- ─────────────────────────────────────────────────────────────────

begin;

-- 1. Extender check constraint de zona
alter table crm_projects drop constraint if exists crm_projects_zona_check;
alter table crm_projects add constraint crm_projects_zona_check
  check (zona is null or zona in ('Norte', 'Interior', 'Sur', 'Valle', 'Costa'));

-- 2. Actualizar zonas según CSV corporativo
update crm_projects
   set zona = case
     when client_city = 'Cali'         then 'Valle'
     when client_city = 'Barranquilla' then 'Costa'
     when client_city = 'Turbaco'      then 'Costa'
     when client_city = 'Cartagena'    then 'Costa'
     else zona
   end
 where created_by = 'seed-mig-40';

-- 3. Vincular categorías del catálogo — INVERSOR
update crm_projects
   set diseno_inversor_categoria_id = (
     select id from inventory_categories where code = case diseno_inversor_marca
       when 'Deye 15k'     then 'DEYE_INV_15KW_HV'
       when 'Deye 6k'      then 'DEYE_INV_6KW_LV'
       when 'Livoltek 10k' then 'LIVOLTEK_INV_10KW'
       when 'Livoltek 15k' then 'LIVOLTEK_INV_15KW'
     end
   )
 where created_by = 'seed-mig-40'
   and diseno_inversor_categoria_id is null
   and diseno_inversor_marca is not null;

-- 4. Vincular categorías del catálogo — BATERÍA
update crm_projects
   set diseno_bateria_categoria_id = (
     select id from inventory_categories where code = case diseno_bateria_marca
       when 'Deye HV'   then 'DEYE_BAT_HV_4KWH'
       when 'Livoltek'  then 'LIVOLTEK_BAT_HV'
       when 'Pylontech' then 'PYLONTECH_BAT_LV'
     end
   )
 where created_by = 'seed-mig-40'
   and diseno_bateria_categoria_id is null
   and diseno_bateria_marca is not null;

-- 5. Vincular categorías del catálogo — PANEL (todos son JA Solar 595w)
update crm_projects
   set diseno_panel_categoria_id = (
     select id from inventory_categories where code = 'JASOLAR_PANEL_595W'
   )
 where created_by = 'seed-mig-40'
   and diseno_panel_categoria_id is null;

commit;

-- Verificación:
-- select count(*) filter (where zona in ('Valle','Costa'))            as zonas_ok,
--        count(*) filter (where diseno_inversor_categoria_id is not null) as inv_linked,
--        count(*) filter (where diseno_bateria_categoria_id is not null)  as bat_linked,
--        count(*) filter (where diseno_panel_categoria_id is not null)    as pan_linked,
--        count(*)                                                          as total
--   from crm_projects
--  where created_by = 'seed-mig-40';
-- Esperado: 33 · 33 · 33 · 33 · 33
