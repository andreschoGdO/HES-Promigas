-- ─────────────────────────────────────────────────────────────────
-- Cleanup previo a re-correr la migración 40
--
-- Borra TODO lo que insertó (o intentó insertar) la migración 40 en un
-- run anterior. Idempotente: si no hay nada, no rompe.
--
-- Correr ANTES de ejecutar 40_seed_33_casas_operativas.sql cuando falló
-- por "duplicate key" u otro error a mitad de la transacción.
-- ─────────────────────────────────────────────────────────────────

begin;

-- 1) Inventory items sembrados (todos tienen created_by='seed-mig-40')
delete from inventory_movements
 where item_id in (select id from inventory_items where created_by = 'seed-mig-40');
delete from inventory_items where created_by = 'seed-mig-40';

-- Por si algún serial quedó suelto sin el created_by seteado (paranoia):
delete from inventory_items where serial_number like 'INST-RDP-%';
delete from inventory_items where serial_number like 'INST-LAB-%';
delete from inventory_items where serial_number like 'INST-TBK-%';
delete from inventory_items where serial_number like 'INST-PRI-%';

-- 2) Facturación sembrada
delete from facturacion_records where created_by = 'seed-mig-40';

-- 3) Eventos del CRM
delete from crm_project_events
 where actor_email = 'seed-mig-40'
    or notes like '%mig 40%';

-- 4) Proyectos CRM sembrados
delete from crm_projects
 where notes like '%JA Solar 595w%'
   and contractor_name = 'Estruccon';

-- 5) Casas placeholder (todas empiezan con PEND-)
delete from client_houses where cliente_id like 'PEND-%';

-- 6) Categorías nuevas (solo si no tienen items ni consumables usándolas)
delete from inventory_categories
 where code in ('METER_SOLAR', 'METER_GEN', 'MODEM')
   and not exists (select 1 from inventory_items    where category_id = inventory_categories.id)
   and not exists (select 1 from inventory_consumables where category_id = inventory_categories.id);

commit;

-- Verificación (debe dar 0/0/0/0):
-- select
--   (select count(*) from client_houses    where cliente_id like 'PEND-%')            as casas,
--   (select count(*) from crm_projects     where notes like '%JA Solar 595w%')        as proyectos,
--   (select count(*) from facturacion_records where created_by='seed-mig-40')         as facturaciones,
--   (select count(*) from inventory_items  where created_by='seed-mig-40')            as items;
